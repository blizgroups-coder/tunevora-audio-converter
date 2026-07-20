```js
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
  width="470"
  height="120"
  viewBox="0 0 470 120"
  xmlns="http://www.w3.org/2000/svg"
>
  <defs>
    <linearGradient
      id="tunevoraGradient"
      x1="0"
      y1="1"
      x2="1"
      y2="0"
    >
      <stop offset="0%" stop-color="#4B00FF"/>
      <stop offset="45%" stop-color="#A600FF"/>
      <stop offset="100%" stop-color="#FF007A"/>
    </linearGradient>

    <filter
      id="softGlow"
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
    >
      <feGaussianBlur
        stdDeviation="2.5"
        result="blur"
      />
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect
    x="0"
    y="0"
    width="470"
    height="120"
    rx="32"
    fill="#050510"
    fill-opacity="0.62"
    stroke="#FFFFFF"
    stroke-opacity="0.16"
    stroke-width="1.5"
  />

  <g
    transform="translate(22 13)"
    filter="url(#softGlow)"
  >
    <path
      d="
        M22 10
        C22 3 29 0 35 4
        L92 43
        C99 48 99 58 92 63
        L35 101
        C29 105 22 102 22 94
        Z
      "
      fill="url(#tunevoraGradient)"
    />

    <path
      d="
        M52 31
        C52 27 56 25 60 28
        L82 43
        C86 46 86 52 82 55
        L60 70
        C56 73 52 71 52 66
        Z
      "
      fill="#060611"
    />

    <path
      d="M63 40 L77 49 L63 58 Z"
      fill="url(#tunevoraGradient)"
    />

    <path
      d="
        M8 15
        C8 7 14 2 22 4
        L34 9
        C27 14 23 22 23 31
        L23 91
        C23 99 18 105 10 106
        C5 106 2 102 2 97
        L2 24
        C2 20 4 17 8 15
        Z
      "
      fill="url(#tunevoraGradient)"
    />
  </g>

  <line
    x1="132"
    y1="24"
    x2="132"
    y2="96"
    stroke="#FFFFFF"
    stroke-opacity="0.18"
    stroke-width="2"
  />

  <text
    x="155"
    y="72"
    font-family="DejaVu Sans, Arial, sans-serif"
    font-size="48"
    font-weight="700"
    letter-spacing="-1"
    fill="url(#tunevoraGradient)"
  >
    Tunevora
  </text>
</svg>
`;

/* ===================================================== */
/* 🎵 ROOT ROUTE                                         */
/* ===================================================== */

app.get("/", (req, res) => {
  res.send(
    "Tunevora Audio Converter Running 🎵"
  );
});

/* ===================================================== */
/* ❤️ PRODUCTION HEALTH CHECK                            */
/* ===================================================== */

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "tunevora-audio-server",
    status: "healthy",
    uptime_seconds: Math.floor(
      process.uptime()
    ),
    timestamp: new Date().toISOString(),
  });
});

/* ===================================================== */
/* 🧪 CONVERSION TEST                                    */
/* ===================================================== */

app.get(
  "/convert-test",
  async (req, res) => {
    try {
      await convertAudio(
        "input.mp3",
        "output_64.mp3",
        "64k"
      );

      return res.json({
        success: true,
        message:
          "Conversion test complete",
      });
    } catch (e) {
      return res.status(500).json({
        error: e.message,
      });
    }
  }
);

/* ===================================================== */
/* 📤 BASIC AUDIO UPLOAD TEST                            */
/* ===================================================== */

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

      return res.json({
        success: true,
        file: req.file.filename,
      });
    } catch (e) {
      return res.status(500).json({
        error: e.message,
      });
    }
  }
);

/* ===================================================== */
/* 🎧 AUDIO CONVERSION                                   */
/* ===================================================== */

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

      console.log(
        "🎧 MASTER FORMAT:",
        result.masterFormat
      );

      console.log(
        "🎧 BIT DEPTH:",
        result.masterBitDepth
      );

      console.log(
        "🎧 SAMPLE RATE:",
        result.masterSampleRate
      );

      console.log(
        "🎧 CODEC:",
        result.masterCodec
      );

      console.log(
        "🎧 CHANNELS:",
        result.masterChannels
      );

      console.log(
        "🎧 DURATION:",
        result.duration
      );

      /* --------------------------------------------- */
      /* Upload generated audio files to Cloudflare R2 */
      /* --------------------------------------------- */

      const timestamp = Date.now();

      const freeUrl = await uploadToR2(
        result.free64,
        `${timestamp}_64.mp3`,
        "songs",
        "audio/mpeg"
      );

      const standardUrl =
        await uploadToR2(
          result.standard128,
          `${timestamp}_128.mp3`,
          "songs",
          "audio/mpeg"
        );

      const premiumUrl =
        await uploadToR2(
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

      /* --------------------------------------------- */
      /* Delete temporary local audio files            */
      /* --------------------------------------------- */

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

      /* --------------------------------------------- */
      /* Return Cloudflare R2 URLs                     */
      /* --------------------------------------------- */

      return res.json({
        success: true,

        files: {
          free_audio_url:
            freeUrl,

          standard_audio_url:
            standardUrl,

          premium_audio_url:
            premiumUrl,

          lossless_audio_url:
            losslessUrl,

          hires48_audio_url:
            hires48Url,

          hires96_audio_url:
            hires96Url,

          hires192_audio_url:
            hires192Url,

          master_format:
            result.masterFormat,

          master_bit_depth:
            result.masterBitDepth,

          master_sample_rate:
            result.masterSampleRate,
        },
      });
    } catch (e) {
      console.error(
        "❌ AUDIO CONVERSION ERROR:",
        e
      );

      return res.status(500).json({
        error: e.message,
      });
    }
  }
);

/* ===================================================== */
/* 🖼️ COVER UPLOAD AND WATERMARK                        */
/* ===================================================== */

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
            input:
              Buffer.from(watermarkSvg),

            gravity: "southeast",
          },
        ])
        .jpeg({
          quality: 90,
        })
        .toFile(outputPath);

      const coverUrl =
        await uploadToR2(
          outputPath,
          `cover_${Date.now()}.jpg`,
          "covers",
          "image/jpeg"
        );

      fs.unlinkSync(req.file.path);
      fs.unlinkSync(outputPath);

      return res.json({
        success: true,
        cover_url: coverUrl,
      });
    } catch (e) {
      console.error(
        "❌ COVER UPLOAD ERROR:",
        e
      );

      return res.status(500).json({
        error: e.message,
      });
    }
  }
);

/* ===================================================== */
/* 🚀 SERVER STARTUP                                     */
/* ===================================================== */

const PORT =
  process.env.PORT || 3000;

const server = app.listen(
  PORT,
  () => {
    console.log(
      `🚀 Tunevora Audio Server running on port ${PORT}`
    );
  }
);

/* ===================================================== */
/* 🛑 GRACEFUL SHUTDOWN                                  */
/* ===================================================== */

let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(
    `🛑 ${signal} received. Closing Tunevora Audio Server...`
  );

  server.close((error) => {
    if (error) {
      console.error(
        "❌ Audio Server shutdown error:",
        error
      );

      process.exit(1);
    }

    console.log(
      "✅ Tunevora Audio Server closed successfully"
    );

    process.exit(0);
  });

  setTimeout(() => {
    console.error(
      "❌ Forced shutdown: server did not close within 10 seconds"
    );

    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT");
});
```
