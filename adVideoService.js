const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const MIN_AD_VIDEO_DURATION_SECONDS = 1;
const MAX_AD_VIDEO_DURATION_SECONDS = 30;

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(
          new Error(
            "Invalid or unsupported video file."
          )
        );
        return;
      }

      const streams =
        Array.isArray(metadata.streams)
          ? metadata.streams
          : [];

      const videoStream =
        streams.find(
          (stream) =>
            stream.codec_type === "video"
        );

      if (!videoStream) {
        reject(
          new Error(
            "No video stream was found in the uploaded file."
          )
        );
        return;
      }

      const duration =
        Number(
          metadata.format &&
            metadata.format.duration
        );

      if (
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        reject(
          new Error(
            "Unable to determine video duration."
          )
        );
        return;
      }

      if (
        duration <
          MIN_AD_VIDEO_DURATION_SECONDS ||
        duration >
          MAX_AD_VIDEO_DURATION_SECONDS
      ) {
        reject(
          new Error(
            `Video ads must be between ${MIN_AD_VIDEO_DURATION_SECONDS} and ${MAX_AD_VIDEO_DURATION_SECONDS} seconds.`
          )
        );
        return;
      }

      const audioStream =
        streams.find(
          (stream) =>
            stream.codec_type === "audio"
        ) || null;

      resolve({
        duration,
        width:
          Number(videoStream.width) || null,
        height:
          Number(videoStream.height) ||
          null,
        videoCodec:
          videoStream.codec_name || null,
        audioCodec:
          audioStream
            ? audioStream.codec_name || null
            : null,
        hasAudio:
          Boolean(audioStream),
        sourceBitRate:
          Number(
            metadata.format &&
              metadata.format.bit_rate
          ) || null,
      });
    });
  });
}

function compressAdVideo(inputPath) {
  return new Promise(
    async (resolve, reject) => {
      let metadata;

      try {
        metadata =
          await probeVideo(inputPath);
      } catch (error) {
        reject(error);
        return;
      }

      const outputPath =
        path.join(
          path.dirname(inputPath),
          `ad_video_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 10)}.mp4`
        );

      let command =
        ffmpeg(inputPath)
          .videoCodec("libx264")
          .videoFilters(
            "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
          )
          .outputOptions([
            "-preset medium",
            "-crf 23",
            "-maxrate 2500k",
            "-bufsize 5000k",
            "-pix_fmt yuv420p",
            "-movflags +faststart",
          ]);

      if (metadata.hasAudio) {
        command =
          command
            .audioCodec("aac")
            .audioBitrate("128k")
            .audioChannels(2);
      } else {
        command =
          command.noAudio();
      }

      command
        .on("error", (error) => {
          try {
            if (
              fs.existsSync(outputPath)
            ) {
              fs.unlinkSync(outputPath);
            }
          } catch (_) {}

          reject(
            new Error(
              `Video compression failed: ${error.message}`
            )
          );
        })
        .on("end", () => {
          let outputSizeBytes = null;

          try {
            outputSizeBytes =
              fs.statSync(outputPath).size;
          } catch (_) {}

          resolve({
            outputPath,
            duration:
              metadata.duration,
            width:
              metadata.width,
            height:
              metadata.height,
            videoCodec:
              metadata.videoCodec,
            audioCodec:
              metadata.audioCodec,
            hasAudio:
              metadata.hasAudio,
            sourceBitRate:
              metadata.sourceBitRate,
            outputSizeBytes,
          });
        })
        .save(outputPath);
    }
  );
}

module.exports = {
  MIN_AD_VIDEO_DURATION_SECONDS,
  MAX_AD_VIDEO_DURATION_SECONDS,
  probeVideo,
  compressAdVideo,
};
