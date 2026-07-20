const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

/*
|--------------------------------------------------------------------------
| Tunevora Audio Processor
|--------------------------------------------------------------------------
|
| Creates:
| - AAC 128 kbps
| - MP3 320 kbps
| - Lossless FLAC, only from a genuine lossless source
| - Hi-Res FLAC, only from a genuine 24-bit source above 48 kHz
|
| Important:
| - Never upscales sample rate.
| - Never labels MP3/AAC sources as Lossless.
| - Never labels an upsampled file as Hi-Res.
| - Dolby Atmos and Sony 360 remain supported by the architecture,
|   but require separate genuine immersive masters.
|
*/

const PROCESSING_VERSION = "tunevora-audio-v1.0.0";

/*
|--------------------------------------------------------------------------
| Utility helpers
|--------------------------------------------------------------------------
*/

function createOutputPath(inputFile, filename) {
  const outputDirectory = path.dirname(inputFile);

  return path.join(outputDirectory, filename);
}

function parseInteger(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
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

  const codec = (codecName || "").toLowerCase();
  const ext = (extension || "").toLowerCase();

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

  if (format) {
    return format;
  }

  if (ext) {
    return ext;
  }

  return codec || "unknown";
}

/*
|--------------------------------------------------------------------------
| Legacy MP3 converter
|--------------------------------------------------------------------------
|
| Kept because your server currently imports convertAudio for /convert-test.
|
*/

function convertAudio(input, output, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate(bitrate)
      .format("mp3")
      .on("start", (commandLine) => {
        console.log("🎵 MP3 COMMAND:", commandLine);
      })
      .on("end", () => resolve(output))
      .on("error", (error) => reject(error))
      .save(output);
  });
}

/*
|--------------------------------------------------------------------------
| AAC 128 kbps
|--------------------------------------------------------------------------
*/

function convertAac128(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioCodec("aac")
      .audioBitrate("128k")
      .outputOptions([
        "-movflags +faststart",
      ])
      .format("ipod")
      .on("start", (commandLine) => {
        console.log("🎵 AAC 128 COMMAND:", commandLine);
      })
      .on("end", () => resolve(output))
      .on("error", (error) => reject(error))
      .save(output);
  });
}

/*
|--------------------------------------------------------------------------
| MP3 320 kbps
|--------------------------------------------------------------------------
*/

function convertMp3320(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("320k")
      .outputOptions([
        "-compression_level 0",
      ])
      .format("mp3")
      .on("start", (commandLine) => {
        console.log("🎵 MP3 320 COMMAND:", commandLine);
      })
      .on("end", () => resolve(output))
      .on("error", (error) => reject(error))
      .save(output);
  });
}

/*
|--------------------------------------------------------------------------
| Genuine Lossless FLAC
|--------------------------------------------------------------------------
|
| This preserves the original sample rate.
| It does not increase the original bit depth.
|
*/

function convertLossless(
  input,
  output,
  bitDepth,
  sampleRate
) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      .noVideo()
      .audioCodec("flac")
      .outputOptions([
        "-compression_level 8",
      ]);

    if (sampleRate > 0) {
      command.audioFrequency(sampleRate);
    }

    if (bitDepth > 16) {
      /*
       * FFmpeg uses signed 32-bit sample storage for 24-bit FLAC input.
       * The FLAC stream can still record the valid raw depth as 24-bit.
       */
      command.outputOptions([
        "-sample_fmt s32",
      ]);
    } else {
      command.outputOptions([
        "-sample_fmt s16",
      ]);
    }

    command
      .format("flac")
      .on("start", (commandLine) => {
        console.log("🎵 LOSSLESS COMMAND:", commandLine);
      })
      .on("end", () => resolve(output))
      .on("error", (error) => reject(error))
      .save(output);
  });
}

/*
|--------------------------------------------------------------------------
| Genuine Hi-Res FLAC
|--------------------------------------------------------------------------
|
| Hi-Res is generated only when the original artist master qualifies.
| The original sample rate is preserved exactly.
|
| Examples:
| 24-bit / 96 kHz master  -> 24-bit / 96 kHz FLAC
| 24-bit / 192 kHz master -> 24-bit / 192 kHz FLAC
|
| Never:
| 16-bit / 44.1 kHz -> 24-bit / 96 kHz
|
*/

function convertHiRes(
  input,
  output,
  originalSampleRate
) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioCodec("flac")
      .audioFrequency(originalSampleRate)
      .outputOptions([
        "-sample_fmt s32",
        "-compression_level 8",
      ])
      .format("flac")
      .on("start", (commandLine) => {
        console.log("🎵 HI-RES COMMAND:", commandLine);
      })
      .on("end", () => resolve(output))
      .on("error", (error) => reject(error))
      .save(output);
  });
}

/*
|--------------------------------------------------------------------------
| Original master metadata
|--------------------------------------------------------------------------
*/

function getAudioMetadata(inputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputFile, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      const audioStream = metadata.streams.find(
        (stream) => stream.codec_type === "audio"
      );

      if (!audioStream) {
        reject(new Error("No audio stream found"));
        return;
      }

      const extension = path
        .extname(inputFile)
        .replace(".", "")
        .toLowerCase();

      const codec =
        (audioStream.codec_name || "unknown")
          .toLowerCase();

      const masterFormat = normalizeMasterFormat({
        formatName: metadata.format?.format_name,
        codecName: codec,
        extension,
      });

      const reportedBitDepth =
        parseInteger(audioStream.bits_per_raw_sample) ||
        parseInteger(audioStream.bits_per_sample);

      const inferredBitDepth =
        inferBitDepthFromCodec(codec);

      const masterBitDepth =
        reportedBitDepth || inferredBitDepth;

      const masterSampleRate =
        parseInteger(audioStream.sample_rate);

      const channels =
        parseInteger(audioStream.channels);

      const duration =
        parseNumber(
          metadata.format?.duration ||
          audioStream.duration
        );

      const bitRate =
        parseInteger(
          audioStream.bit_rate ||
          metadata.format?.bit_rate
        );

      const channelLayout =
        audioStream.channel_layout ||
        "unknown";

      resolve({
        masterFormat,
        masterCodec: codec,
        masterBitDepth,
        masterSampleRate,
        masterChannels: channels,
        masterChannelLayout: channelLayout,
        masterBitRate: bitRate,
        duration,
      });
    });
  });
}

/*
|--------------------------------------------------------------------------
| Source validation
|--------------------------------------------------------------------------
*/

function isLosslessSource(metadata) {
  const format =
    (metadata.masterFormat || "").toLowerCase();

  const codec =
    (metadata.masterCodec || "").toLowerCase();

  const knownLosslessFormats = [
    "wav",
    "wave",
    "flac",
    "aiff",
    "aif",
    "alac",
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

function isGenuineHiResSource(metadata) {
  return (
    isLosslessSource(metadata) &&
    metadata.masterBitDepth >= 24 &&
    metadata.masterSampleRate > 48000
  );
}

/*
|--------------------------------------------------------------------------
| Create all Tunevora audio versions
|--------------------------------------------------------------------------
*/

async function createAllVersions(inputFile) {
  const timestamp = Date.now();

  const metadata =
    await getAudioMetadata(inputFile);

  console.log(
    "🎧 ORIGINAL MASTER METADATA:",
    metadata
  );

  const sourceIsLossless =
    isLosslessSource(metadata);

  const sourceIsHiRes =
    isGenuineHiResSource(metadata);

  const aac128 = createOutputPath(
    inputFile,
    `song_${timestamp}_aac128.m4a`
  );

  const mp3320 = createOutputPath(
    inputFile,
    `song_${timestamp}_mp3320.mp3`
  );

  let lossless = null;
  let hires = null;

  /*
   * AAC and MP3 are always generated because they are
   * compatible streaming versions.
   */
  await convertAac128(
    inputFile,
    aac128
  );

  await convertMp3320(
    inputFile,
    mp3320
  );

  /*
   * Lossless is created only from a real lossless source.
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
   * Hi-Res is created only when the original master is:
   *
   * - Lossless
   * - At least 24-bit
   * - Above 48 kHz
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

  return {
    /*
     * New permanent quality-based field names.
     */
    aac128,
    mp3320,
    lossless,
    hires,

    /*
     * Original artist upload.
     * The server will upload this file to the private master folder in R2.
     */
    masterFile: inputFile,

    /*
     * Immersive formats require separate real master packages.
     * They remain part of the permanent architecture.
     */
    dolbyAtmos: null,
    sony360: null,
    binaural: null,
    immersive: null,

    /*
     * Original master metadata.
     */
    masterFormat:
      metadata.masterFormat,

    masterCodec:
      metadata.masterCodec,

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

    duration:
      metadata.duration,

    /*
     * Tunevora Studio Quality verification.
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

    studioQuality:
      sourceIsHiRes
        ? "hi_res_lossless"
        : sourceIsLossless
          ? "lossless"
          : "high_quality",

    processingVersion:
      PROCESSING_VERSION,
  };
}

module.exports = {
  /*
   * Existing compatibility export.
   */
  convertAudio,

  /*
   * New converters.
   */
  convertAac128,
  convertMp3320,
  convertLossless,
  convertHiRes,

  /*
   * Metadata and validation.
   */
  getAudioMetadata,
  isLosslessSource,
  isGenuineHiResSource,

  /*
   * Main pipeline.
   */
  createAllVersions,
};