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

function convertHiRes48(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec("flac")
      .audioFrequency(48000)
      .outputOptions([
        "-sample_fmt s32",
      ])
      .format("flac")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

function convertHiRes96(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec("flac")
      .audioFrequency(96000)
      .outputOptions([
        "-sample_fmt s32",
      ])
      .format("flac")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

function convertHiRes192(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec("flac")
      .audioFrequency(192000)
      .outputOptions([
        "-sample_fmt s32",
      ])
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
  let hires48 = null;
  let hires96 = null;
  let hires192 = null;

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
];

const losslessSourceCodecs = [
  "flac",
  "alac",
];

const isLosslessSource =
  losslessSourceFormats.includes(metadata.masterFormat) ||
  losslessSourceCodecs.includes(metadata.codec) ||
  metadata.codec.startsWith("pcm_");

if (isLosslessSource) {
  lossless = `song_${timestamp}_lossless.flac`;

  await convertLossless(
    inputFile,
    lossless
  );
}

if (
  isLosslessSource &&
  metadata.masterBitDepth >= 24 &&
  metadata.masterSampleRate >= 48000
) {
  hires48 = `song_${timestamp}_hires48.flac`;

  await convertHiRes48(
    inputFile,
    hires48
  );
}

if (
  isLosslessSource &&
  metadata.masterBitDepth >= 24 &&
  metadata.masterSampleRate >= 96000
) {
  hires96 = `song_${timestamp}_hires96.flac`;

  await convertHiRes96(
    inputFile,
    hires96
  );
}

if (
  isLosslessSource &&
  metadata.masterBitDepth >= 24 &&
  metadata.masterSampleRate >= 192000
) {
  hires192 = `song_${timestamp}_hires192.flac`;

  await convertHiRes192(
    inputFile,
    hires192
  );
}

  return {
    free64,
    standard128,
    premium320,
    lossless,
    hires48,
    hires96,
    hires192,

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
  convertHiRes48,
  convertHiRes96,
  convertHiRes192,
  getAudioMetadata,
  createAllVersions,
};