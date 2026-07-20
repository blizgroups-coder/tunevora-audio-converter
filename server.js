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

/*
|--------------------------------------------------------------------------
| Upload directory
|--------------------------------------------------------------------------
|
| Railway containers may start without an uploads directory.
| Create it automatically before Multer starts receiving files.
|
*/

const uploadsDirectory = path.join(
  __dirname,
  "uploads"
);

fs.mkdirSync(uploadsDirectory, {
  recursive: true,
});

const upload = multer({
  dest: uploadsDirectory,
});

/*
|--------------------------------------------------------------------------
| Safe temporary-file cleanup
|--------------------------------------------------------------------------
|
| Never allow a missing temporary file to crash the server.
|
*/

function safeDeleteFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);

      console.log(
        "🧹 TEMP FILE DELETED:",
        filePath
      );
    }
  } catch (error) {
    console.error(
      "⚠️ TEMP FILE CLEANUP FAILED:",
      filePath,
      error.message
    );
  }
}

/*
|--------------------------------------------------------------------------
| Tunevora cover watermark
|--------------------------------------------------------------------------
*/

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
    const inputPath = path.join(
      __dirname,
      "input.mp3"
    );

    const outputPath = path.join(
      __dirname,
      "output_64.mp3"
    );

    try {
      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({
          success: false,
          error:
            "input.mp3 was not found in the server folder",
        });
      }

      await convertAudio(
        inputPath,
        outputPath,
        "64k"
      );

      return res.json({
        success: true,
        message:
          "Conversion test complete",
        output_file:
          path.basename(outputPath),
      });
    } catch (error) {
      console.error(
        "❌ CONVERSION TEST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message,
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
          success: false,
          error: "No file uploaded",
        });
      }

      return res.json({
        success: true,
        file: req.file.filename,
        original_name:
          req.file.originalname,
        mime_type:
          req.file.mimetype,
        size_bytes:
          req.file.size,
      });
    } catch (error) {
      console.error(
        "❌ BASIC UPLOAD ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message,
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
    let result = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file uploaded",
        });
      }

      console.log(
        "🎵 AUDIO UPLOAD RECEIVED:",
        {
          originalName:
            req.file.originalname,
          mimeType:
            req.file.mimetype,
          sizeBytes:
            req.file.size,
          temporaryPath:
            req.file.path,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Create Tunevora audio versions
      |--------------------------------------------------------------------------
      */

      result = await createAllVersions(
        req.file.path
      );

      console.log(
        "🎧 MASTER METADATA:",
        {
          format:
            result.masterFormat,
          codec:
            result.masterCodec,
          bitDepth:
            result.masterBitDepth,
          sampleRate:
            result.masterSampleRate,
          channels:
            result.masterChannels,
          channelLayout:
            result.masterChannelLayout,
          bitRate:
            result.masterBitRate,
          duration:
            result.duration,
          studioQuality:
            result.studioQuality,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Upload generated files to Cloudflare R2
      |--------------------------------------------------------------------------
      */

      const timestamp = Date.now();

      /*
       * Free plan:
       * AAC 128 kbps.
       */
      const aac128Url =
        await uploadToR2(
          result.aac128,
          `${timestamp}_aac128.m4a`,
          "songs",
          "audio/mp4"
        );

      /*
       * Standard plan:
       * MP3 320 kbps.
       */
      const mp3320Url =
        await uploadToR2(
          result.mp3320,
          `${timestamp}_mp3320.mp3`,
          "songs",
          "audio/mpeg"
        );

      /*
       * Lossless exists only when the artist uploaded
       * a genuine lossless source.
       */
      let losslessUrl = null;

      if (result.lossless) {
        losslessUrl =
          await uploadToR2(
            result.lossless,
            `${timestamp}_lossless.flac`,
            "songs",
            "audio/flac"
          );
      }

      /*
       * Hi-Res exists only when the original master is:
       *
       * - Lossless
       * - At least 24-bit
       * - Above 48 kHz
       */
      let hiresUrl = null;

      if (result.hires) {
        hiresUrl =
          await uploadToR2(
            result.hires,
            `${timestamp}_hires_${result.masterSampleRate}.flac`,
            "songs",
            "audio/flac"
          );
      }

      /*
      |--------------------------------------------------------------------------
      | Preserve existing Flutter and Supabase field names
      |--------------------------------------------------------------------------
      |
      | free_audio_url:
      | AAC 128 kbps
      |
      | standard_audio_url:
      | MP3 320 kbps
      |
      | premium_audio_url:
      | Hi-Res first, then Lossless, then MP3 fallback
      |
      */

      const freeAudioUrl =
        aac128Url;

      const standardAudioUrl =
        mp3320Url;

      const premiumAudioUrl =
        hiresUrl ||
        losslessUrl ||
        mp3320Url;

      /*
      |--------------------------------------------------------------------------
      | Return Cloudflare R2 URLs and master verification data
      |--------------------------------------------------------------------------
      */

      return res.status(200).json({
        success: true,

        files: {
          /*
           * Existing app-compatible fields.
           */
          free_audio_url:
            freeAudioUrl,

          standard_audio_url:
            standardAudioUrl,

          premium_audio_url:
            premiumAudioUrl,

          /*
           * New permanent quality fields.
           */
          aac128_audio_url:
            aac128Url,

          mp3320_audio_url:
            mp3320Url,

          lossless_audio_url:
            losslessUrl,

          hires_audio_url:
            hiresUrl,

          /*
           * Old Hi-Res fields retained temporarily
           * for compatibility.
           */
          hires48_audio_url:
            result.masterSampleRate ===
              48000
              ? hiresUrl
              : null,

          hires96_audio_url:
            result.masterSampleRate ===
              96000
              ? hiresUrl
              : null,

          hires192_audio_url:
            result.masterSampleRate ===
              192000
              ? hiresUrl
              : null,

          /*
           * Original master metadata.
           */
          master_format:
            result.masterFormat,

          master_codec:
            result.masterCodec,

          master_bit_depth:
            result.masterBitDepth,

          master_sample_rate:
            result.masterSampleRate,

          master_channels:
            result.masterChannels,

          master_channel_layout:
            result.masterChannelLayout,

          master_bit_rate:
            result.masterBitRate,

          duration_seconds:
            result.duration,

          /*
           * Verification results.
           */
          verified_master:
            result.verifiedMaster,

          verified_lossless:
            result.verifiedLossless,

          verified_hires:
            result.verifiedHiRes,

          verified_dolby_atmos:
            result.verifiedDolbyAtmos,

          verified_sony_360:
            result.verifiedSony360,

          studio_quality:
            result.studioQuality,

          processing_version:
            result.processingVersion,

          /*
           * Future immersive audio fields.
           */
          dolby_atmos_audio_url:
            null,

          sony360_audio_url:
            null,

          binaural_audio_url:
            null,

          immersive_audio_url:
            null,
        },
      });
    } catch (error) {
      console.error(
        "❌ AUDIO CONVERSION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message,
      });
    } finally {
      /*
      |--------------------------------------------------------------------------
      | Always remove temporary local files
      |--------------------------------------------------------------------------
      |
      | This runs after success and after failure.
      |
      */

      if (result) {
        safeDeleteFile(
          result.aac128
        );

        safeDeleteFile(
          result.mp3320
        );

        safeDeleteFile(
          result.lossless
        );

        safeDeleteFile(
          result.hires
        );
      }

      if (req.file) {
        safeDeleteFile(
          req.file.path
        );
      }
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
    let outputPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No cover uploaded",
        });
      }

      outputPath = path.join(
        uploadsDirectory,
        `watermarked_${Date.now()}.jpg`
      );

      await sharp(req.file.path)
        .resize(1000, 1000, {
          fit: "cover",
          position: "center",
        })
        .composite([
          {
            input:
              Buffer.from(
                watermarkSvg
              ),

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

      return res.status(200).json({
        success: true,
        cover_url: coverUrl,
      });
    } catch (error) {
      console.error(
        "❌ COVER UPLOAD ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message,
      });
    } finally {
      if (req.file) {
        safeDeleteFile(
          req.file.path
        );
      }

      safeDeleteFile(
        outputPath
      );
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

    console.log(
      `📁 Temporary upload directory: ${uploadsDirectory}`
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