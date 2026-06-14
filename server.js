const path = require("path");
const fs = require("fs");
const { convertAudio } = require("./ffmpegService");

const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Tunevora Audio Converter Running 🎵");
});

app.get("/convert-test", async (req, res) => {
  try {
    await convertAudio(
      "input.mp3",
      "output_64.mp3",
      "64k"
    );

    res.json({
      success: true,
      message: "Conversion test complete",
    });

  } catch (e) {

    res.status(500).json({
      error: e.message,
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});