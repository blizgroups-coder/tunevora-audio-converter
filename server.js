const path = require("path");
const fs = require("fs");

const {
  convertAudio,
  createAllVersions,
} = require("./ffmpegService");

const { uploadToR2 } = require("./r2Service");

const express = require("express");
const multer = require("multer");
const sharp = require("sharp");

const app = express();

const upload = multer({
  dest: "uploads/",
});
const watermarkSvg = `
<svg
  width="360"
  height="100"
  viewBox="0 0 360 100"
  xmlns="http://www.w3.org/2000/svg"
>
  <!-- Rounded translucent background -->
  <rect
    x="0"
    y="0"
    width="360"
    height="100"
    rx="28"
    fill="#000000"
    fill-opacity="0.48"
  />

  <!-- Tunevora music icon -->
  <circle
    cx="55"
    cy="64"
    r="15"
    fill="#E100FF"
  />

  <circle
    cx="93"
    cy="54"
    r="15"
    fill="#FF0080"
  />

  <path
    d="M68 22
       L108 12
       L108 54
       L98 54
       L98 28
       L68 36
       L68 64
       L58 64
       L58 26
       Z"
    fill="white"
  />

  <!-- Tunevora name -->
  <text
    x="130"
    y="64"
    fill="white"
    fill-opacity="0.96"
    font-size="38"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="700"
    letter-spacing="1">
    Tunevora
  </text>
</svg>
`;
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

     const result = await createAllVersions(
       req.file.path
     );

     console.log("🎧 MASTER FORMAT:", result.masterFormat);
     console.log("🎧 BIT DEPTH:", result.masterBitDepth);
     console.log("🎧 SAMPLE RATE:", result.masterSampleRate);
     console.log("🎧 CODEC:", result.masterCodec);
     console.log("🎧 CHANNELS:", result.masterChannels);
     console.log("🎧 DURATION:", result.duration);


      // Upload to Cloudflare R2
      const timestamp = Date.now();

      const freeUrl = await uploadToR2(
        result.free64,
        `${timestamp}_64.mp3`,
        "songs",
        "audio/mpeg"
      );

      const standardUrl = await uploadToR2(
        result.standard128,
        `${timestamp}_128.mp3`,
        "songs",
        "audio/mpeg"
      );

      const premiumUrl = await uploadToR2(
        result.premium320,
        `${timestamp}_320.mp3`,
        "songs",
        "audio/mpeg"
        );
      
      
      let losslessUrl = null;

      if (result.lossless) {
        losslessUrl = await uploadToR2(
          result.lossless,
          `${timestamp}_lossless.flac`,
          "songs",
          "audio/flac"
        );
      }
      
      let hires48Url = null;
      let hires96Url = null;
      let hires192Url = null;

      if (result.hires48) {
      hires48Url = await uploadToR2(
      result.hires48,
      `${timestamp}_hires48.flac`,
      "songs",
      "audio/flac"
      );
     }

     if (result.hires96) {
     hires96Url = await uploadToR2(
     result.hires96,
    `${timestamp}_hires96.flac`,
    "songs",
    "audio/flac"
      );
     }

     if (result.hires192) {
     hires192Url = await uploadToR2(
     result.hires192,
     `${timestamp}_hires192.flac`,
     "songs",
     "audio/flac"
       );
      }
      
      // Delete temporary files
      fs.unlinkSync(req.file.path);

      if (result.hires48) {
      fs.unlinkSync(result.hires48);
      }

      if (result.hires96) {
      fs.unlinkSync(result.hires96);
      }

      if (result.hires192) {
      fs.unlinkSync(result.hires192);
      }

      fs.unlinkSync(result.free64);
      fs.unlinkSync(result.standard128);
      fs.unlinkSync(result.premium320);

      if (result.lossless) {
        fs.unlinkSync(result.lossless);
      }

      // Return R2 URLs
      res.json({
       success: true,
       files: {
         free_audio_url: freeUrl,
         standard_audio_url: standardUrl,
         premium_audio_url: premiumUrl,
         lossless_audio_url: losslessUrl,

         hires48_audio_url: hires48Url,
         hires96_audio_url: hires96Url,
         hires192_audio_url: hires192Url,

         master_format: result.masterFormat,
         master_bit_depth: result.masterBitDepth,
         master_sample_rate: result.masterSampleRate,
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
app.post(
  "/upload-cover",
  upload.single("cover"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          error: "No cover uploaded",
        });
      }

      const outputPath =
        `uploads/watermarked_${Date.now()}.jpg`;

      await sharp(req.file.path)
        .resize(1000, 1000, {
          fit: "cover",
          position: "center",
        })
        .composite([
          {
            input: Buffer.from(watermarkSvg),
            gravity: "southeast",
          },
        ])
        .jpeg({
          quality: 90,
        })
        .toFile(outputPath);

       const coverUrl = await uploadToR2(
         outputPath,
         `cover_${Date.now()}.jpg`,
          "covers",
          "image/jpeg"
      );
        
      fs.unlinkSync(req.file.path);
      fs.unlinkSync(outputPath);

      res.json({
        success: true,
        cover_url: coverUrl,
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