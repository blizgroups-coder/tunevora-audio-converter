const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

function convertAudio(input, output, bitrate) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioBitrate(bitrate)
      .toFormat("mp3")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

module.exports = {
  convertAudio,
};