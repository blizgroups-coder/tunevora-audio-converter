const path = require("path");
const fs = require("fs");

const {
  convertAudio,
  createAllVersions,
} = require("./ffmpegService");

const express = require("express");
const multer = require("multer");

const app = express();

const upload = multer({
  dest: "uploads/",
});

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

app.post(
  "/upload",
  upload.single("audio"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
        });
      }

      res.json({
        success: true,
        file: req.file.filename,
      });

    } catch (e) {

      res.status(500).json({
        error: e.message,
      });
    }
  }
);

app.post(
  "/convert",
  upload.single("audio"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
        });
      }

      const result =
        await createAllVersions(
          req.file.path
        );

      res.json({
        success: true,
        files: result,
      });

    } catch (e) {

      res.status(500).json({
        error: e.message,
      });
    }
  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});