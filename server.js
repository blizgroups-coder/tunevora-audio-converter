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

  <!-- TUNEVORA as vector lines: no font required -->
<g
  transform="translate(125 30)"
  fill="none"
  stroke="white"
  stroke-width="5"
  stroke-linecap="round"
  stroke-linejoin="round"
  opacity="0.96"
>
  <!-- T -->
  <path d="M0 0 H20 M10 0 V36" />

  <!-- U -->
  <path
    transform="translate(27 0)"
    d="M0 0 V26 Q0 36 10 36 Q20 36 20 26 V0"
  />

  <!-- N -->
  <path
    transform="translate(54 0)"
    d="M0 36 V0 L20 36 V0"
  />

  <!-- E -->
  <path
    transform="translate(81 0)"
    d="M20 0 H0 V36 H20 M0 18 H16"
  />

  <!-- V -->
  <path
    transform="translate(108 0)"
    d="M0 0 L10 36 L20 0"
  />

  <!-- O -->
  <rect
    x="135"
    y="0"
    width="20"
    height="36"
    rx="9"
  />

  <!-- R -->
  <path
    transform="translate(162 0)"
    d="M0 36 V0 H10 Q20 0 20 9 Q20 18 10 18 H0 M10 18 L22 36"
  />

  <!-- A -->
  <path
    transform="translate(191 0)"
    d="M0 36 L10 0 L20 36 M4 23 H16"
  />
</g>
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