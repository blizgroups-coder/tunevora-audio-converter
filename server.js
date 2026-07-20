const path = require("path");
const fs = require("fs");

const {
  PROCESSING_VERSION,
  convertAudio,
  createAllVersions,
} = require("./ffmpegService");

const {
  uploadToR2,
} = require("./r2Service");

const express = require("express");
const multer = require("multer");
const sharp = require("sharp");

const app = express();

/*
|--------------------------------------------------------------------------
| Tunevora Audio Server V2
|--------------------------------------------------------------------------
|
| Streaming plans:
|
| Free:
| - AAC 64 kbps
|
| Standard:
| - AAC 128 kbps
|
| Premium:
| - MP3 320 kbps
|
| Studio qualities:
|
| - Genuine Lossless FLAC
| - Genuine Hi-Res FLAC
|
| Important:
|
| - Lossless is only created from a genuine lossless master.
| - Hi-Res is only created from a genuine 24-bit source above 48 kHz.
| - Premium MP3 does not falsely claim to improve a low-quality source.
|
*/

const SERVER_VERSION =
  "tunevora-audio-server-v2.0.0";

/*
|--------------------------------------------------------------------------
| Express configuration
|--------------------------------------------------------------------------
*/

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "2mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb",
  })
);

/*
|--------------------------------------------------------------------------
| Temporary upload directory
|--------------------------------------------------------------------------
|
| Railway containers may start without the directory.
| Create it before Multer starts handling uploads.
|
*/

const uploadsDirectory = path.join(
  __dirname,
  "uploads"
);

fs.mkdirSync(uploadsDirectory, {
  recursive: true,
});

/*
|--------------------------------------------------------------------------
| Multer upload configuration
|--------------------------------------------------------------------------
*/

const MAX_AUDIO_UPLOAD_SIZE =
  500 * 1024 * 1024;

const MAX_COVER_UPLOAD_SIZE =
  15 * 1024 * 1024;

const upload = multer({
  dest: uploadsDirectory,

  limits: {
    fileSize:
      MAX_AUDIO_UPLOAD_SIZE,
    files: 1,
  },
});

const coverUpload = multer({
  dest: uploadsDirectory,

  limits: {
    fileSize:
      MAX_COVER_UPLOAD_SIZE,
    files: 1,
  },
});

/*
|--------------------------------------------------------------------------
| Supported upload types
|--------------------------------------------------------------------------
*/

const SUPPORTED_AUDIO_EXTENSIONS =
  new Set([
    ".mp3",
    ".m4a",
    ".aac",
    ".wav",
    ".wave",
    ".flac",
    ".aif",
    ".aiff",
    ".alac",
    ".ogg",
    ".opus",
  ]);

const SUPPORTED_COVER_EXTENSIONS =
  new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
  ]);

/*
|--------------------------------------------------------------------------
| Helper functions
|--------------------------------------------------------------------------
*/

function fileExists(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    return fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

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

function sanitizeFileName(value) {
  return String(value || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

function getFileExtension(fileName) {
  return path
    .extname(fileName || "")
    .toLowerCase();
}

function validateAudioUpload(file) {
  if (!file) {
    throw new Error(
      "No audio file was uploaded"
    );
  }

  const extension =
    getFileExtension(
      file.originalname
    );

  if (
    !SUPPORTED_AUDIO_EXTENSIONS
      .has(extension)
  ) {
    throw new Error(
      `Unsupported audio format: ${
        extension || "unknown"
      }`
    );
  }

  if (
    !fileExists(file.path) ||
    file.size <= 0
  ) {
    throw new Error(
      "Uploaded audio file is empty or unavailable"
    );
  }

  return true;
}

function validateCoverUpload(file) {
  if (!file) {
    throw new Error(
      "No cover artwork was uploaded"
    );
  }

  const extension =
    getFileExtension(
      file.originalname
    );

  if (
    !SUPPORTED_COVER_EXTENSIONS
      .has(extension)
  ) {
    throw new Error(
      `Unsupported cover format: ${
        extension || "unknown"
      }`
    );
  }

  if (
    !fileExists(file.path) ||
    file.size <= 0
  ) {
    throw new Error(
      "Uploaded cover artwork is empty or unavailable"
    );
  }

  return true;
}

function createUploadId() {
  return (
    `${Date.now()}_` +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );
}

function createPublicError(
  error,
  fallbackMessage
) {
  if (
    error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallbackMessage;
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
      <stop
        offset="0%"
        stop-color="#4B00FF"
      />

      <stop
        offset="45%"
        stop-color="#A600FF"
      />

      <stop
        offset="100%"
        stop-color="#FF007A"
      />
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
        <feMergeNode
          in="SourceGraphic"
        />
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

/*
|--------------------------------------------------------------------------
| Root route
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message:
      "Tunevora Audio Converter Running 🎵",
    service:
      "tunevora-audio-server",
    server_version:
      SERVER_VERSION,
    processing_version:
      PROCESSING_VERSION,
  });
});

/*
|--------------------------------------------------------------------------
| Production health check
|--------------------------------------------------------------------------
*/

app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,
    service:
      "tunevora-audio-server",
    server_version:
      SERVER_VERSION,
    processing_version:
      PROCESSING_VERSION,
    status: "healthy",

    uptime_seconds:
      Math.floor(
        process.uptime()
      ),

    memory: {
      rss_bytes:
        process.memoryUsage().rss,

      heap_used_bytes:
        process.memoryUsage()
          .heapUsed,

      heap_total_bytes:
        process.memoryUsage()
          .heapTotal,
    },

    timestamp:
      new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| Audio conversion test
|--------------------------------------------------------------------------
*/

app.get(
  "/convert-test",
  async (req, res) => {
    const inputPath =
      path.join(
        __dirname,
        "input.mp3"
      );

    const outputPath =
      path.join(
        __dirname,
        "output_64.mp3"
      );

    try {
      if (!fs.existsSync(inputPath)) {
        return res
          .status(404)
          .json({
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

      return res.status(200).json({
        success: true,

        message:
          "Conversion test complete",

        output_file:
          path.basename(
            outputPath
          ),
      });
    } catch (error) {
      console.error(
        "❌ CONVERSION TEST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          createPublicError(
            error,
            "Conversion test failed"
          ),
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| Basic audio upload test
|--------------------------------------------------------------------------
*/

app.post(
  "/upload",
  upload.single("audio"),
  async (req, res) => {
    try {
      validateAudioUpload(
        req.file
      );

      return res.status(200).json({
        success: true,

        file:
          req.file.filename,

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

      return res.status(400).json({
        success: false,

        error:
          createPublicError(
            error,
            "Audio upload failed"
          ),
      });
    } finally {
      if (req.file) {
        safeDeleteFile(
          req.file.path
        );
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| Main audio conversion route
|--------------------------------------------------------------------------
*/

app.post(
  "/convert",
  upload.single("audio"),
  async (req, res) => {
    let result = null;

    const requestStartedAt =
      Date.now();

    const uploadId =
      createUploadId();

    try {
      validateAudioUpload(
        req.file
      );

      console.log(
        "========================================"
      );

      console.log(
        "🎵 TUNEVORA AUDIO UPLOAD RECEIVED"
      );

      console.log({
        uploadId,

        originalName:
          req.file.originalname,

        safeOriginalName:
          sanitizeFileName(
            req.file.originalname
          ),

        mimeType:
          req.file.mimetype,

        sizeBytes:
          req.file.size,

        temporaryPath:
          req.file.path,
      });

      console.log(
        "========================================"
      );

      /*
      |--------------------------------------------------------------------------
      | Generate Tunevora V2 audio versions
      |--------------------------------------------------------------------------
      */

      result =
        await createAllVersions(
          req.file.path
        );

      console.log(
        "🎧 MASTER ANALYSIS:",
        {
          uploadId,

          format:
            result.masterFormat,

          codec:
            result.masterCodec,

          codecLongName:
            result
              .masterCodecLongName,

          bitDepth:
            result.masterBitDepth,

          sampleRate:
            result.masterSampleRate,

          channels:
            result.masterChannels,

          channelLayout:
            result
              .masterChannelLayout,

          bitRate:
            result.masterBitRate,

          bitRateKbps:
            result
              .masterBitRateKbps,

          durationSeconds:
            result.duration,

          fileSize:
            result.masterFileSize,

          sha256:
            result.masterSha256,

          studioQuality:
            result.studioQuality,

          studioQualityLabel:
            result
              .studioQualityLabel,

          premiumSourceVerified:
            result
              .premiumSourceVerified,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Upload all generated audio versions to Cloudflare R2
      |--------------------------------------------------------------------------
      */

      const r2BaseName =
        `${uploadId}_` +
        sanitizeFileName(
          path.basename(
            req.file.originalname,
            path.extname(
              req.file.originalname
            )
          )
        );

      /*
       * Free plan:
       * AAC 64 kbps.
       */

      const freeAac64Url =
        await uploadToR2(
          result.freeAac64,
          `${r2BaseName}_free_aac64.m4a`,
          "songs/free",
          "audio/mp4"
        );

      /*
       * Standard plan:
       * AAC 128 kbps.
       */

      const standardAac128Url =
        await uploadToR2(
          result.standardAac128,
          `${r2BaseName}_standard_aac128.m4a`,
          "songs/standard",
          "audio/mp4"
        );

      /*
       * Premium plan:
       * MP3 320 kbps.
       */

      const premiumMp3320Url =
        await uploadToR2(
          result.premiumMp3320,
          `${r2BaseName}_premium_mp3320.mp3`,
          "songs/premium",
          "audio/mpeg"
        );

      /*
       * Genuine Lossless:
       * Created only from a real lossless source.
       */

      let losslessUrl = null;

      if (result.lossless) {
        losslessUrl =
          await uploadToR2(
            result.lossless,
            `${r2BaseName}_lossless.flac`,
            "songs/lossless",
            "audio/flac"
          );
      }

      /*
       * Genuine Hi-Res:
       * Created only from a genuine qualifying master.
       */

      let hiresUrl = null;

      if (result.hires) {
        hiresUrl =
          await uploadToR2(
            result.hires,
            `${r2BaseName}_hires_${result.masterSampleRate}.flac`,
            "songs/hires",
            "audio/flac"
          );
      }

      /*
      |--------------------------------------------------------------------------
      | Tunevora subscription mapping
      |--------------------------------------------------------------------------
      |
      | Free:
      | AAC 64 kbps
      |
      | Standard:
      | AAC 128 kbps
      |
      | Premium:
      | MP3 320 kbps
      |
      | Lossless and Hi-Res remain separate verified fields.
      |
      */

      const freeAudioUrl =
        freeAac64Url;

      const standardAudioUrl =
        standardAac128Url;

      const premiumAudioUrl =
        premiumMp3320Url;

      const totalRequestDurationMs =
        Date.now() -
        requestStartedAt;

      /*
      |--------------------------------------------------------------------------
      | Return R2 URLs and master verification data
      |--------------------------------------------------------------------------
      */

      return res.status(200).json({
        success: true,

        upload_id:
          uploadId,

        message:
          "Tunevora audio processing completed successfully",

        files: {
          /*
           * ------------------------------------------------------------
           * Existing Flutter and Supabase fields
           * ------------------------------------------------------------
           */

          free_audio_url:
            freeAudioUrl,

          standard_audio_url:
            standardAudioUrl,

          premium_audio_url:
            premiumAudioUrl,

          /*
           * ------------------------------------------------------------
           * Permanent V2 quality URL fields
           * ------------------------------------------------------------
           */

          free_aac64_audio_url:
            freeAac64Url,

          standard_aac128_audio_url:
            standardAac128Url,

          premium_mp3320_audio_url:
            premiumMp3320Url,

          lossless_audio_url:
            losslessUrl,

          hires_audio_url:
            hiresUrl,

          /*
           * ------------------------------------------------------------
           * Compatibility aliases
           * ------------------------------------------------------------
           */

          aac64_audio_url:
            freeAac64Url,

          aac128_audio_url:
            standardAac128Url,

          mp3320_audio_url:
            premiumMp3320Url,

          /*
           * Existing Hi-Res compatibility fields.
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
           * ------------------------------------------------------------
           * Original master metadata
           * ------------------------------------------------------------
           */

          master_format:
            result.masterFormat,

          master_codec:
            result.masterCodec,

          master_codec_long_name:
            result
              .masterCodecLongName,

          master_extension:
            result.masterExtension,

          master_bit_depth:
            result.masterBitDepth,

          master_sample_rate:
            result.masterSampleRate,

          master_channels:
            result.masterChannels,

          master_channel_layout:
            result
              .masterChannelLayout,

          master_bit_rate:
            result.masterBitRate,

          master_bit_rate_kbps:
            result
              .masterBitRateKbps,

          master_file_size:
            result.masterFileSize,

          master_sha256:
            result.masterSha256,

          master_tags:
            result.masterTags,

          duration_seconds:
            result.duration,

          /*
           * ------------------------------------------------------------
           * Source verification
           * ------------------------------------------------------------
           */

          source_is_lossless:
            result.sourceIsLossless,

          source_is_lossy:
            result.sourceIsLossy,

          source_is_studio_master:
            result
              .sourceIsStudioMaster,

          source_is_hires:
            result.sourceIsHiRes,

          premium_source_verified:
            result
              .premiumSourceVerified,

          premium_source_reason:
            result
              .premiumSourceReason,

          /*
           * ------------------------------------------------------------
           * Tunevora verification fields
           * ------------------------------------------------------------
           */

          verified_master:
            result.verifiedMaster,

          verified_lossless:
            result.verifiedLossless,

          verified_hires:
            result.verifiedHiRes,

          verified_dolby_atmos:
            result
              .verifiedDolbyAtmos,

          verified_sony_360:
            result.verifiedSony360,

          /*
           * ------------------------------------------------------------
           * Studio quality classification
           * ------------------------------------------------------------
           */

          studio_quality:
            result.studioQuality,

          studio_quality_label:
            result
              .studioQualityLabel,

          studio_quality_rank:
            result
              .studioQualityRank,

          /*
           * ------------------------------------------------------------
           * Generated-version details
           * ------------------------------------------------------------
           */

          generated_qualities:
            result
              .generatedQualities,

          /*
           * ------------------------------------------------------------
           * Processing information
           * ------------------------------------------------------------
           */

          processing_version:
            result
              .processingVersion,

          processing_duration_ms:
            result
              .processingDurationMs,

          total_request_duration_ms:
            totalRequestDurationMs,

          processed_at:
            result.processedAt,

          /*
           * ------------------------------------------------------------
           * Future immersive audio fields
           * ------------------------------------------------------------
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
        "========================================"
      );

      console.error(
        "❌ TUNEVORA AUDIO CONVERSION ERROR"
      );

      console.error({
        uploadId,
        message: error.message,
        stack: error.stack,
      });

      console.error(
        "========================================"
      );

      const isClientError =
        error.message.includes(
          "Unsupported"
        ) ||
        error.message.includes(
          "No audio"
        ) ||
        error.message.includes(
          "empty"
        ) ||
        error.message.includes(
          "invalid"
        );

      return res
        .status(
          isClientError
            ? 400
            : 500
        )
        .json({
          success: false,

          upload_id:
            uploadId,

          error:
            createPublicError(
              error,
              "Audio processing failed"
            ),
        });
    } finally {
      /*
      |--------------------------------------------------------------------------
      | Always remove all local temporary files
      |--------------------------------------------------------------------------
      */

      if (result) {
        safeDeleteFile(
          result.freeAac64
        );

        safeDeleteFile(
          result.standardAac128
        );

        safeDeleteFile(
          result.premiumMp3320
        );

        safeDeleteFile(
          result.lossless
        );

        safeDeleteFile(
          result.hires
        );

        /*
         * Compatibility file paths may point to the same files.
         * safeDeleteFile checks existence before deleting.
         */

        safeDeleteFile(
          result.aac64
        );

        safeDeleteFile(
          result.aac128
        );

        safeDeleteFile(
          result.mp3320
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

/*
|--------------------------------------------------------------------------
| Cover upload and watermark
|--------------------------------------------------------------------------
*/

app.post(
  "/upload-cover",
  coverUpload.single("cover"),
  async (req, res) => {
    let outputPath = null;

    const uploadId =
      createUploadId();

    try {
      validateCoverUpload(
        req.file
      );

      const imageMetadata =
        await sharp(
          req.file.path
        ).metadata();

      const width =
        imageMetadata.width || 0;

      const height =
        imageMetadata.height || 0;

      if (
        width <= 0 ||
        height <= 0
      ) {
        throw new Error(
          "Cover artwork dimensions could not be detected"
        );
      }

      if (width !== height) {
        throw new Error(
          `Cover artwork must be square. Selected image: ${width} × ${height} px.`
        );
      }

      if (
        width < 1400 ||
        height < 1400
      ) {
        throw new Error(
          `Cover artwork must be at least 1400 × 1400 px. ` +
          `Selected image: ${width} × ${height} px. ` +
          "Recommended: 3000 × 3000 px."
        );
      }

      console.log(
        "🖼️ COVER UPLOAD RECEIVED:",
        {
          uploadId,

          originalName:
            req.file.originalname,

          width,
          height,

          sizeBytes:
            req.file.size,
        }
      );

      outputPath =
        path.join(
          uploadsDirectory,
          `watermarked_${uploadId}.jpg`
        );

      /*
       * Preserve a high-quality square cover.
       * Resize to 3000 × 3000 for consistent catalog artwork.
       */

      await sharp(req.file.path)
        .rotate()
        .resize(3000, 3000, {
          fit: "cover",
          position: "center",
          withoutEnlargement:
            false,
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
          quality: 92,
          chromaSubsampling:
            "4:4:4",
          progressive: true,
        })
        .toFile(outputPath);

      if (!fileExists(outputPath)) {
        throw new Error(
          "Processed cover file was not created"
        );
      }

      const coverUrl =
        await uploadToR2(
          outputPath,
          `cover_${uploadId}.jpg`,
          "covers",
          "image/jpeg"
        );

      return res.status(200).json({
        success: true,

        upload_id:
          uploadId,

        cover_url:
          coverUrl,

        original_width:
          width,

        original_height:
          height,

        output_width:
          3000,

        output_height:
          3000,

        output_format:
          "jpeg",
      });
    } catch (error) {
      console.error(
        "❌ COVER UPLOAD ERROR:",
        error
      );

      const isClientError =
        error.message.includes(
          "Unsupported"
        ) ||
        error.message.includes(
          "square"
        ) ||
        error.message.includes(
          "at least"
        ) ||
        error.message.includes(
          "dimensions"
        ) ||
        error.message.includes(
          "empty"
        );

      return res
        .status(
          isClientError
            ? 400
            : 500
        )
        .json({
          success: false,

          upload_id:
            uploadId,

          error:
            createPublicError(
              error,
              "Cover processing failed"
            ),
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

/*
|--------------------------------------------------------------------------
| Multer error handler
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      console.error(
        "❌ MULTER ERROR:",
        error
      );

      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(413)
          .json({
            success: false,

            error:
              "Uploaded file is larger than the permitted limit",
          });
      }

      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    next(error);
  }
);

/*
|--------------------------------------------------------------------------
| Final server error handler
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "❌ UNHANDLED SERVER ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({
      success: false,

      error:
        "An unexpected server error occurred",
    });
  }
);

/*
|--------------------------------------------------------------------------
| Server startup
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 3000;

const server = app.listen(
  PORT,
  () => {
    console.log(
      "========================================"
    );

    console.log(
      `🚀 Tunevora Audio Server running on port ${PORT}`
    );

    console.log(
      `🧠 Server version: ${SERVER_VERSION}`
    );

    console.log(
      `🎧 Processing version: ${PROCESSING_VERSION}`
    );

    console.log(
      `📁 Temporary upload directory: ${uploadsDirectory}`
    );

    console.log(
      "🎵 Free: AAC 64 kbps"
    );

    console.log(
      "🎵 Standard: AAC 128 kbps"
    );

    console.log(
      "🎵 Premium: MP3 320 kbps"
    );

    console.log(
      "========================================"
    );
  }
);

/*
|--------------------------------------------------------------------------
| Graceful shutdown
|--------------------------------------------------------------------------
*/

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

process.on(
  "SIGTERM",
  () => {
    gracefulShutdown(
      "SIGTERM"
    );
  }
);

process.on(
  "SIGINT",
  () => {
    gracefulShutdown(
      "SIGINT"
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "❌ UNCAUGHT EXCEPTION:",
      error
    );

    gracefulShutdown(
      "uncaughtException"
    );
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "❌ UNHANDLED REJECTION:",
      reason
    );
  }
);