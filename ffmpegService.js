const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

function convertAudio(input, output, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioBitrate(bitrate)
      .audioCodec("libmp3lame")
      .format("mp3")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

async function createAllVersions(inputFile) {

  const free64 = "song_64.mp3";
  const standard128 = "song_128.mp3";
  const premium320 = "song_320.mp3";

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

  return {
    free64,
    standard128,
    premium320,
  };
}

module.exports = {
  convertAudio,
  createAllVersions,
};