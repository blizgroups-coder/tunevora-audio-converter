const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

/*
|--------------------------------------------------------------------------
| Tunevora Audio Processor V2
|--------------------------------------------------------------------------
|
| Streaming versions:
|
| Free:
| - AAC 64 kbps
|
| Standard:
| - AAC 128 kbps
|
| Premium:
| - MP3 320 kbps
|
| Studio versions:
|
| - Lossless FLAC only when the original source is genuinely lossless
| - Hi-Res FLAC only when the original source is genuinely:
|     • Lossless
|     • At least 24-bit
|     • Above 48 kHz
|
| Important:
|
| - Never upscales sample rate
| - Never labels MP3/AAC sources as lossless
| - Never creates fake Hi-Res files
| - Never claims converted 320 kbps MP3 is better than its source
| - Keeps compatibility with the existing Tunevora server
|
*/

const PROCESSING_VERSION = "tunevora-audio-v2.0.0";

/*
|--------------------------------------------------------------------------
| Quality configuration
|--------------------------------------------------------------------------
*/

const AUDIO_PRESETS = Object.freeze({
  free: Object.freeze({
    codec: "aac",
    bitrate: "64k",
    container: "ipod",
    extension: "m4a",
  }),

  standard: Object.freeze({
    codec: "aac",
    bitrate: "128k",
    container: "ipod",
    extension: "m4a",
  }),

  premium: Object.freeze({
    codec: "libmp3lame",
    bitrate: "320k",
    container: "mp3",
    extension: "mp3",
  }),
});

/*
|--------------------------------------------------------------------------
| Utility helpers
|--------------------------------------------------------------------------
*/

function createOutputPath(inputFile, filename) {
  return path.join(path.dirname(inputFile), filename);
}

function parseInteger(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function fileExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    return fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

function getFileSize(filePath) {
  if (!fileExists(filePath)) {
    return 0;
  }

  try {
    return fs.statSync(filePath).size;
  } catch (_) {
    return 0;
  }
}

function safeDeleteFile(filePath) {
  if (!filePath || !fileExists(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error(
      `⚠️ Could not delete temporary file: ${filePath}`,
      error.message
    );
  }
}

function calculateCompressionRatio(
  originalSize,
  convertedSize
) {
  if (
    originalSize <= 0 ||
    convertedSize <= 0
  ) {
    return 0;
  }

  return Number(
    (convertedSize / originalSize).toFixed(4)
  );
}

function inferBitDepthFromCodec(codecName = "") {
  const codec = codecName.toLowerCase();

  if (
    codec.includes("pcm_s8") ||
    codec.includes("pcm_u8")
  ) {
    return 8;
  }

  if (
    codec.includes("pcm_s16") ||
    codec.includes("pcm_u16")
  ) {
    return 16;
  }

  if (
    codec.includes("pcm_s24") ||
    codec.includes("pcm_u24")
  ) {
    return 24;
  }

  if (
    codec.includes("pcm_s32") ||
    codec.includes("pcm_u32") ||
    codec.includes("pcm_f32")
  ) {
    return 32;
  }

  if (codec.includes("pcm_f64")) {
    return 64;
  }

  return 0;
}

function normalizeMasterFormat({
  formatName,
  codecName,
  extension,
}) {
  const format = (formatName || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  const codec = (codecName || "")
    .trim()
    .toLowerCase();

  const ext = (extension || "")
    .replace(".", "")
    .trim()
    .toLowerCase();

  if (codec === "flac") {
    return "flac";
  }

  if (codec === "alac") {
    return "alac";
  }

  if (codec.startsWith("pcm_")) {
    if (
      format.includes("aiff") ||
      ext === "aif" ||
      ext === "aiff"
    ) {
      return "aiff";
    }

    return "wav";
  }

  if (
    codec === "mp3" ||
    format.includes("mp3")
  ) {
    return "mp3";
  }

  if (
    codec === "aac" ||
    format.includes("aac")
  ) {
    return "aac";
  }

  if (
    format.includes("mov") ||
    format.includes("mp4") ||
    format.includes("m4a")
  ) {
    return ext || "m4a";
  }

  if (format) {
    return format;
  }

  if (ext) {
    return ext;
  }

  return codec || "unknown";
}

function getBitrateKbps(bitRate) {
  const value = parseInteger(bitRate);

  if (value <= 0) {
    return 0;
  }

  return Math.round(value / 1000);
}

/*
|--------------------------------------------------------------------------
| SHA-256 master checksum
|--------------------------------------------------------------------------
|
| This allows Tunevora to detect an exact duplicate upload even when the
| filename has been changed.
|
*/

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("error", reject);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

/*
|--------------------------------------------------------------------------
| FFmpeg conversion helper
|--------------------------------------------------------------------------
*/

function runConversion({
  input,
  output,
  codec,
  bitrate,
  format,
  outputOptions = [],
  sampleRate = 0,
  channels = 0,
  label = "AUDIO",
}) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      .noVideo()
      .audioCodec(codec);

    if (bitrate) {
      command.audioBitrate(bitrate);
    }

    if (sampleRate > 0) {
      command.audioFrequency(sampleRate);
    }

    if (channels > 0) {
      command.audioChannels(channels);
    }

    if (outputOptions.length > 0) {
      command.outputOptions(outputOptions);
    }

    command
      .format(format)
      .on("start", (commandLine) => {
        console.log(`🎵 ${label} COMMAND:`);
        console.log(commandLine);
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          console.log(
            `🎚️ ${label}: ${Math.round(progress.percent)}%`
          );
        }
      })
      .on("end", () => {
        if (!fileExists(output)) {
          reject(
            new Error(
              `${label} conversion finished but output file was not created`
            )
          );
          return;
        }

        const outputSize = getFileSize(output);

        if (outputSize <= 0) {
          safeDeleteFile(output);

          reject(
            new Error(
              `${label} conversion created an empty output file`
            )
          );
          return;
        }

        console.log(
          `✅ ${label} READY: ${output} (${outputSize} bytes)`
        );

        resolve(output);
      })
      .on("error", (error) => {
        safeDeleteFile(output);

        console.error(
          `❌ ${label} CONVERSION ERROR:`,
          error.message
        );

        reject(error);
      })
      .save(output);
  });
}

/*
|--------------------------------------------------------------------------
| Legacy MP3 converter
|--------------------------------------------------------------------------
|
| Kept because server.js may still import this for /convert-test.
|
*/

function convertAudio(input, output, bitrate) {
  return runConversion({
    input,
    output,
    codec: "libmp3lame",
    bitrate,
    format: "mp3",
    outputOptions: [
      "-map_metadata -1",
      "-id3v2_version 3",
    ],
    label: `LEGACY MP3 ${bitrate}`,
  });
}

/*
|--------------------------------------------------------------------------
| Free — AAC 64 kbps
|--------------------------------------------------------------------------
*/

function convertAac64(input, output) {
  return runConversion({
    input,
    output,
    codec: AUDIO_PRESETS.free.codec,
    bitrate: AUDIO_PRESETS.free.bitrate,
    format: AUDIO_PRESETS.free.container,
    outputOptions: [
      "-movflags +faststart",
      "-map_metadata -1",
    ],
    label: "FREE AAC 64",
  });
}

/*
|--------------------------------------------------------------------------
| Standard — AAC 128 kbps
|--------------------------------------------------------------------------
*/

function convertAac128(input, output) {
  return runConversion({
    input,
    output,
    codec: AUDIO_PRESETS.standard.codec,
    bitrate: AUDIO_PRESETS.standard.bitrate,
    format: AUDIO_PRESETS.standard.container,
    outputOptions: [
      "-movflags +faststart",
      "-map_metadata -1",
    ],
    label: "STANDARD AAC 128",
  });
}

/*
|--------------------------------------------------------------------------
| Premium — MP3 320 kbps
|--------------------------------------------------------------------------
*/

function convertMp3320(input, output) {
  return runConversion({
    input,
    output,
    codec: AUDIO_PRESETS.premium.codec,
    bitrate: AUDIO_PRESETS.premium.bitrate,
    format: AUDIO_PRESETS.premium.container,
    outputOptions: [
      "-compression_level 0",
      "-map_metadata -1",
      "-id3v2_version 3",
    ],
    label: "PREMIUM MP3 320",
  });
}

/*
|--------------------------------------------------------------------------
| Genuine Lossless FLAC
|--------------------------------------------------------------------------
|
| The original sample rate is preserved.
| The source bit depth is never artificially increased.
|
*/

function convertLossless(
  input,
  output,
  bitDepth,
  sampleRate
) {
  const outputOptions = [
    "-compression_level 8",
    "-map_metadata -1",
  ];

  if (bitDepth > 16) {
    outputOptions.push("-sample_fmt s32");
  } else {
    outputOptions.push("-sample_fmt s16");
  }

  return runConversion({
    input,
    output,
    codec: "flac",
    format: "flac",
    sampleRate,
    outputOptions,
    label: "GENUINE LOSSLESS FLAC",
  });
}

/*
|--------------------------------------------------------------------------
| Genuine Hi-Res FLAC
|--------------------------------------------------------------------------
|
| Hi-Res is generated only from a genuine qualifying master.
|
| Example:
|
| 24-bit / 96 kHz source
| -> 24-bit / 96 kHz FLAC
|
| It will never convert:
|
| 16-bit / 44.1 kHz
| -> fake 24-bit / 96 kHz
|
*/

function convertHiRes(
  input,
  output,
  originalSampleRate
) {
  return runConversion({
    input,
    output,
    codec: "flac",
    format: "flac",
    sampleRate: originalSampleRate,
    outputOptions: [
      "-sample_fmt s32",
      "-compression_level 8",
      "-map_metadata -1",
    ],
    label: "GENUINE HI-RES FLAC",
  });
}

/*
|--------------------------------------------------------------------------
| Original master metadata
|--------------------------------------------------------------------------
*/

function getAudioMetadata(inputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(
      inputFile,
      (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }

        const audioStream =
          metadata.streams.find(
            (stream) =>
              stream.codec_type === "audio"
          );

        if (!audioStream) {
          reject(
            new Error(
              "No valid audio stream was found in the uploaded file"
            )
          );
          return;
        }

        const extension = path
          .extname(inputFile)
          .replace(".", "")
          .toLowerCase();

        const codec = (
          audioStream.codec_name || "unknown"
        ).toLowerCase();

        const codecLongName =
          audioStream.codec_long_name ||
          "unknown";

        const masterFormat =
          normalizeMasterFormat({
            formatName:
              metadata.format?.format_name,
            codecName: codec,
            extension,
          });

        const reportedBitDepth =
          parseInteger(
            audioStream.bits_per_raw_sample
          ) ||
          parseInteger(
            audioStream.bits_per_sample
          );

        const inferredBitDepth =
          inferBitDepthFromCodec(codec);

        const masterBitDepth =
          reportedBitDepth ||
          inferredBitDepth;

        const masterSampleRate =
          parseInteger(
            audioStream.sample_rate
          );

        const masterChannels =
          parseInteger(
            audioStream.channels
          );

        const duration =
          parseNumber(
            metadata.format?.duration ||
              audioStream.duration
          );

        const masterBitRate =
          parseInteger(
            audioStream.bit_rate ||
              metadata.format?.bit_rate
          );

        const masterChannelLayout =
          audioStream.channel_layout ||
          "unknown";

        const formatTags =
          metadata.format?.tags || {};

        const streamTags =
          audioStream.tags || {};

        const tags = {
          title:
            formatTags.title ||
            streamTags.title ||
            null,

          artist:
            formatTags.artist ||
            streamTags.artist ||
            null,

          album:
            formatTags.album ||
            streamTags.album ||
            null,

          albumArtist:
            formatTags.album_artist ||
            streamTags.album_artist ||
            null,

          genre:
            formatTags.genre ||
            streamTags.genre ||
            null,

          date:
            formatTags.date ||
            streamTags.date ||
            null,

          track:
            formatTags.track ||
            streamTags.track ||
            null,

          disc:
            formatTags.disc ||
            streamTags.disc ||
            null,

          composer:
            formatTags.composer ||
            streamTags.composer ||
            null,

          copyright:
            formatTags.copyright ||
            streamTags.copyright ||
            null,

          encoder:
            formatTags.encoder ||
            streamTags.encoder ||
            null,

          isrc:
            formatTags.isrc ||
            formatTags.ISRC ||
            streamTags.isrc ||
            streamTags.ISRC ||
            null,
        };

        resolve({
          masterFormat,
          masterCodec: codec,
          masterCodecLongName: codecLongName,
          masterBitDepth,
          masterSampleRate,
          masterChannels,
          masterChannelLayout,
          masterBitRate,
          masterBitRateKbps:
            getBitrateKbps(masterBitRate),
          duration,
          fileSize: getFileSize(inputFile),
          extension,
          tags,
        });
      }
    );
  });
}

/*
|--------------------------------------------------------------------------
| Source validation
|--------------------------------------------------------------------------
*/

function isLosslessSource(metadata) {
  const format = (
    metadata.masterFormat || ""
  ).toLowerCase();

  const codec = (
    metadata.masterCodec || ""
  ).toLowerCase();

  const knownLosslessFormats = [
    "wav",
    "wave",
    "flac",
    "aiff",
    "aif",
    "alac",
    "ape",
    "wavpack",
  ];

  const knownLosslessCodecs = [
    "flac",
    "alac",
    "wavpack",
    "ape",
  ];

  return (
    knownLosslessFormats.includes(format) ||
    knownLosslessCodecs.includes(codec) ||
    codec.startsWith("pcm_")
  );
}

function isLossySource(metadata) {
  return !isLosslessSource(metadata);
}

function isGenuineHiResSource(metadata) {
  return (
    isLosslessSource(metadata) &&
    metadata.masterBitDepth >= 24 &&
    metadata.masterSampleRate > 48000
  );
}

function isStudioMasterSource(metadata) {
  return (
    isLosslessSource(metadata) &&
    metadata.masterBitDepth >= 24 &&
    metadata.masterSampleRate >= 44100
  );
}

/*
|--------------------------------------------------------------------------
| Master quality classification
|--------------------------------------------------------------------------
*/

function classifyMasterQuality(metadata) {
  const bitrateKbps =
    metadata.masterBitRateKbps ||
    getBitrateKbps(
      metadata.masterBitRate
    );

  if (isGenuineHiResSource(metadata)) {
    return {
      code: "hi_res_lossless",
      label: "Hi-Res Lossless",
      rank: 6,
    };
  }

  if (isStudioMasterSource(metadata)) {
    return {
      code: "studio_master",
      label: "Studio Master",
      rank: 5,
    };
  }

  if (isLosslessSource(metadata)) {
    return {
      code: "lossless",
      label: "Lossless",
      rank: 4,
    };
  }

  if (bitrateKbps >= 300) {
    return {
      code: "high_quality",
      label: "High Quality",
      rank: 3,
    };
  }

  if (bitrateKbps >= 128) {
    return {
      code: "standard_quality",
      label: "Standard Quality",
      rank: 2,
    };
  }

  return {
    code: "low_quality",
    label: "Low Quality",
    rank: 1,
  };
}

/*
|--------------------------------------------------------------------------
| Determine whether the source can genuinely support Premium quality
|--------------------------------------------------------------------------
|
| A lower-quality source can still be encoded into an MP3 file configured
| at 320 kbps, but this does not restore quality that was already lost.
|
*/

function evaluatePremiumSource(metadata) {
  if (isLosslessSource(metadata)) {
    return {
      premiumSourceVerified: true,
      premiumSourceReason:
        "Original master is lossless.",
    };
  }

  const bitrateKbps =
    metadata.masterBitRateKbps ||
    getBitrateKbps(
      metadata.masterBitRate
    );

  if (bitrateKbps >= 300) {
    return {
      premiumSourceVerified: true,
      premiumSourceReason:
        "Original lossy master is approximately 300 kbps or higher.",
    };
  }

  return {
    premiumSourceVerified: false,
    premiumSourceReason:
      `Original source is approximately ${bitrateKbps} kbps. ` +
      "Creating a 320 kbps file does not restore lost source quality.",
  };
}

/*
|--------------------------------------------------------------------------
| Validate uploaded master
|--------------------------------------------------------------------------
*/

function validateMasterMetadata(metadata) {
  if (!metadata.masterCodec) {
    throw new Error(
      "The uploaded file does not contain a recognized audio codec"
    );
  }

  if (metadata.duration <= 0) {
    throw new Error(
      "The uploaded audio has an invalid duration"
    );
  }

  if (metadata.masterSampleRate <= 0) {
    throw new Error(
      "The uploaded audio has an invalid sample rate"
    );
  }

  if (metadata.masterChannels <= 0) {
    throw new Error(
      "The uploaded audio has no valid audio channels"
    );
  }

  if (metadata.fileSize <= 0) {
    throw new Error(
      "The uploaded audio file is empty"
    );
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| Create all Tunevora audio versions
|--------------------------------------------------------------------------
*/

async function createAllVersions(inputFile) {
  if (!inputFile) {
    throw new Error(
      "Input audio file path is required"
    );
  }

  if (!fileExists(inputFile)) {
    throw new Error(
      `Input audio file does not exist: ${inputFile}`
    );
  }

  const processingStartedAt = Date.now();
  const timestamp =
    `${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}`;

  let freeAac64 = null;
  let standardAac128 = null;
  let premiumMp3320 = null;
  let lossless = null;
  let hires = null;

  try {
    const [
      metadata,
      masterSha256,
    ] = await Promise.all([
      getAudioMetadata(inputFile),
      calculateFileHash(inputFile),
    ]);

    validateMasterMetadata(metadata);

    console.log(
      "========================================"
    );
    console.log(
      "🎧 TUNEVORA ORIGINAL MASTER METADATA"
    );
    console.log(metadata);
    console.log(
      `🔐 SHA-256: ${masterSha256}`
    );
    console.log(
      "========================================"
    );

    const sourceIsLossless =
      isLosslessSource(metadata);

    const sourceIsHiRes =
      isGenuineHiResSource(metadata);

    const sourceIsStudioMaster =
      isStudioMasterSource(metadata);

    const masterQuality =
      classifyMasterQuality(metadata);

    const premiumEvaluation =
      evaluatePremiumSource(metadata);

    freeAac64 = createOutputPath(
      inputFile,
      `song_${timestamp}_free_aac64.m4a`
    );

    standardAac128 = createOutputPath(
      inputFile,
      `song_${timestamp}_standard_aac128.m4a`
    );

    premiumMp3320 = createOutputPath(
      inputFile,
      `song_${timestamp}_premium_mp3320.mp3`
    );

    /*
     * Free, Standard and Premium streaming versions can be generated
     * concurrently because they do not depend on each other.
     */
    await Promise.all([
      convertAac64(
        inputFile,
        freeAac64
      ),

      convertAac128(
        inputFile,
        standardAac128
      ),

      convertMp3320(
        inputFile,
        premiumMp3320
      ),
    ]);

    /*
     * Generate genuine Lossless only from a real lossless source.
     */
    if (sourceIsLossless) {
      lossless = createOutputPath(
        inputFile,
        `song_${timestamp}_lossless.flac`
      );

      await convertLossless(
        inputFile,
        lossless,
        metadata.masterBitDepth,
        metadata.masterSampleRate
      );
    }

    /*
     * Generate genuine Hi-Res only when the original master qualifies.
     */
    if (sourceIsHiRes) {
      hires = createOutputPath(
        inputFile,
        `song_${timestamp}_hires_${metadata.masterSampleRate}.flac`
      );

      await convertHiRes(
        inputFile,
        hires,
        metadata.masterSampleRate
      );
    }

    const originalSize =
      metadata.fileSize;

    const freeFileSize =
      getFileSize(freeAac64);

    const standardFileSize =
      getFileSize(standardAac128);

    const premiumFileSize =
      getFileSize(premiumMp3320);

    const losslessFileSize =
      getFileSize(lossless);

    const hiresFileSize =
      getFileSize(hires);

    const processingDurationMs =
      Date.now() - processingStartedAt;

    console.log(
      "========================================"
    );
    console.log(
      "✅ TUNEVORA AUDIO PROCESSING COMPLETE"
    );
    console.log(
      `Version: ${PROCESSING_VERSION}`
    );
    console.log(
      `Processing time: ${processingDurationMs} ms`
    );
    console.log(
      `Quality: ${masterQuality.label}`
    );
    console.log(
      "========================================"
    );

    return {
      /*
       * --------------------------------------------------------------
       * Tunevora V2 quality field names
       * --------------------------------------------------------------
       */

      freeAac64,
      standardAac128,
      premiumMp3320,
      lossless,
      hires,

      /*
       * --------------------------------------------------------------
       * Existing compatibility field names
       * --------------------------------------------------------------
       *
       * These prevent your current server.js from immediately breaking.
       *
       * Old:
       * aac128
       * mp3320
       *
       * New mapping:
       *
       * aac128 -> Standard AAC 128
       * mp3320 -> Premium MP3 320
       */

      aac64: freeAac64,
      aac128: standardAac128,
      mp3320: premiumMp3320,

      /*
       * Original master file.
       */
      masterFile: inputFile,

      /*
       * Future immersive formats require separate genuine master assets.
       */
      dolbyAtmos: null,
      sony360: null,
      binaural: null,
      immersive: null,

      /*
       * --------------------------------------------------------------
       * Original master metadata
       * --------------------------------------------------------------
       */

      masterFormat:
        metadata.masterFormat,

      masterCodec:
        metadata.masterCodec,

      masterCodecLongName:
        metadata.masterCodecLongName,

      masterBitDepth:
        metadata.masterBitDepth,

      masterSampleRate:
        metadata.masterSampleRate,

      masterChannels:
        metadata.masterChannels,

      masterChannelLayout:
        metadata.masterChannelLayout,

      masterBitRate:
        metadata.masterBitRate,

      masterBitRateKbps:
        metadata.masterBitRateKbps,

      duration:
        metadata.duration,

      durationSeconds:
        metadata.duration,

      masterFileSize:
        metadata.fileSize,

      masterExtension:
        metadata.extension,

      masterTags:
        metadata.tags,

      masterSha256,

      /*
       * --------------------------------------------------------------
       * Source verification
       * --------------------------------------------------------------
       */

      sourceIsLossless,
      sourceIsLossy:
        isLossySource(metadata),

      sourceIsStudioMaster,
      sourceIsHiRes,

      premiumSourceVerified:
        premiumEvaluation
          .premiumSourceVerified,

      premiumSourceReason:
        premiumEvaluation
          .premiumSourceReason,

      /*
       * --------------------------------------------------------------
       * Tunevora verification fields
       * --------------------------------------------------------------
       */

      verifiedMaster:
        sourceIsLossless &&
        metadata.masterBitDepth > 0 &&
        metadata.masterSampleRate > 0,

      verifiedLossless:
        sourceIsLossless &&
        lossless !== null,

      verifiedHiRes:
        sourceIsHiRes &&
        hires !== null,

      verifiedDolbyAtmos: false,
      verifiedSony360: false,

      /*
       * --------------------------------------------------------------
       * Master classification
       * --------------------------------------------------------------
       */

      studioQuality:
        masterQuality.code,

      studioQualityLabel:
        masterQuality.label,

      studioQualityRank:
        masterQuality.rank,

      /*
       * --------------------------------------------------------------
       * Generated quality information
       * --------------------------------------------------------------
       */

      generatedQualities: {
        free: {
          ready:
            fileExists(freeAac64),

          format: "aac",
          container: "m4a",
          bitrateKbps: 64,
          file: freeAac64,
          fileSize: freeFileSize,
          compressionRatio:
            calculateCompressionRatio(
              originalSize,
              freeFileSize
            ),
        },

        standard: {
          ready:
            fileExists(standardAac128),

          format: "aac",
          container: "m4a",
          bitrateKbps: 128,
          file: standardAac128,
          fileSize: standardFileSize,
          compressionRatio:
            calculateCompressionRatio(
              originalSize,
              standardFileSize
            ),
        },

        premium: {
          ready:
            fileExists(premiumMp3320),

          format: "mp3",
          container: "mp3",
          bitrateKbps: 320,
          file: premiumMp3320,
          fileSize: premiumFileSize,
          compressionRatio:
            calculateCompressionRatio(
              originalSize,
              premiumFileSize
            ),

          sourceVerified:
            premiumEvaluation
              .premiumSourceVerified,

          sourceVerificationReason:
            premiumEvaluation
              .premiumSourceReason,
        },

        lossless: {
          ready:
            fileExists(lossless),

          genuine:
            sourceIsLossless,

          format:
            lossless ? "flac" : null,

          bitDepth:
            lossless
              ? metadata.masterBitDepth
              : null,

          sampleRate:
            lossless
              ? metadata.masterSampleRate
              : null,

          file: lossless,
          fileSize:
            losslessFileSize,
        },

        hires: {
          ready:
            fileExists(hires),

          genuine:
            sourceIsHiRes,

          format:
            hires ? "flac" : null,

          bitDepth:
            hires
              ? metadata.masterBitDepth
              : null,

          sampleRate:
            hires
              ? metadata.masterSampleRate
              : null,

          file: hires,
          fileSize:
            hiresFileSize,
        },
      },

      /*
       * Processing information.
       */
      processingVersion:
        PROCESSING_VERSION,

      processingDurationMs,

      processedAt:
        new Date().toISOString(),
    };
  } catch (error) {
    /*
     * Delete incomplete converted files if processing fails.
     * The original master is not removed here because server.js owns it.
     */

    safeDeleteFile(freeAac64);
    safeDeleteFile(standardAac128);
    safeDeleteFile(premiumMp3320);
    safeDeleteFile(lossless);
    safeDeleteFile(hires);

    console.error(
      "❌ TUNEVORA AUDIO PROCESSING FAILED:",
      error
    );

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| Module exports
|--------------------------------------------------------------------------
*/

module.exports = {
  PROCESSING_VERSION,
  AUDIO_PRESETS,

  /*
   * Existing compatibility export.
   */
  convertAudio,

  /*
   * Streaming converters.
   */
  convertAac64,
  convertAac128,
  convertMp3320,

  /*
   * Studio converters.
   */
  convertLossless,
  convertHiRes,

  /*
   * Metadata and duplicate detection.
   */
  getAudioMetadata,
  calculateFileHash,

  /*
   * Source validation.
   */
  isLosslessSource,
  isLossySource,
  isStudioMasterSource,
  isGenuineHiResSource,
  validateMasterMetadata,

  /*
   * Quality evaluation.
   */
  classifyMasterQuality,
  evaluatePremiumSource,

  /*
   * Main Tunevora processing pipeline.
   */
  createAllVersions,
};