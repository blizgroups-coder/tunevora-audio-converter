const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

function convertAudio(input, output, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec("libmp3lame")
      .audioBitrate(bitrate)
      .format("mp3")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

function convertLossless(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec("flac")
      .format("flac")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

/// 🎧 READ ORIGINAL MASTER QUALITY
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

      const formatFromProbe =
        metadata.format?.format_name
          ?.split(",")[0];
          

      const extension = path
        .extname(inputFile)
        .replace(".", "")
        .toLowerCase();

      const masterFormat =
        formatFromProbe ||
        audioStream.codec_name ||
        extension ||
        "unknown";

      const bitDepth =
       audioStream.bits_per_raw_sample ||
       audioStream.bits_per_sample;

      const masterBitDepth = bitDepth
        ? parseInt(bitDepth, 10)
        : 0;

      const masterSampleRate = Number(
        audioStream.sample_rate || 0
      );

      resolve({
        masterFormat,
        masterBitDepth,
        masterSampleRate,
        codec: audioStream.codec_name || "unknown",
        channels: Number(audioStream.channels || 0),
        duration: Number(metadata.format?.duration || 0),
      });
    });
  });
}

async function createAllVersions(inputFile) {
  const timestamp = Date.now();

  const free64 = `song_${timestamp}_64.mp3`;
  const standard128 = `song_${timestamp}_128.mp3`;
  const premium320 = `song_${timestamp}_320.mp3`;

  let lossless = null;

  const metadata = await getAudioMetadata(inputFile);

  console.log("🎧 MASTER METADATA:", metadata);

  await convertAudio(
    inputFile,
    free64,
    "64k"
  );

  await convertAudio(
    inputFile,
    standard128,
    "128k"
  );

  await convertAudio(
    inputFile,
    premium320,
    "320k"
  );

  const losslessSourceFormats = [
    "wav",
    "flac",
    "aiff",
    "alac",
  ];

  if (losslessSourceFormats.includes(metadata.masterFormat)) {
    lossless = `song_${timestamp}_lossless.flac`;

    await convertLossless(
      inputFile,
      lossless
    );
  }

  return {
    free64,
    standard128,
    premium320,
    lossless,

    masterFormat: metadata.masterFormat,
    masterBitDepth: metadata.masterBitDepth,
    masterSampleRate: metadata.masterSampleRate,
    masterCodec: metadata.codec,
    masterChannels: metadata.channels,
    duration: metadata.duration,
  };
}

module.exports = {
  convertAudio,
  convertLossless,
  getAudioMetadata,
  createAllVersions,
};