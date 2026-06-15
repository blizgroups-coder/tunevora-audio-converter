const path = require("path");
const fs = require("fs");

const {
  convertAudio,
  createAllVersions,
} = require("./ffmpegService");

const { uploadToR2 } = require("./r2Service");

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

      // Create 64k, 128k and 320k versions
      const result = await createAllVersions(
        req.file.path
      );

      // Upload to Cloudflare R2
      const timestamp = Date.now();

      const freeUrl = await uploadToR2(
        result.free64,
        `${timestamp}_64.mp3`
      );

      const standardUrl = await uploadToR2(
        result.standard128,
        `${timestamp}_128.mp3`
      );

      const premiumUrl = await uploadToR2(
        result.premium320,
        `${timestamp}_320.mp3`
      );

      // Delete temporary files
      fs.unlinkSync(req.file.path);

      fs.unlinkSync(result.free64);
      fs.unlinkSync(result.standard128);
      fs.unlinkSync(result.premium320);

      // Return R2 URLs
      res.json({
        success: true,
        files: {
          free_audio_url: freeUrl,
          standard_audio_url: standardUrl,
          premium_audio_url: premiumUrl,
        },
      });

    } catch (e) {

      console.error(e);

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