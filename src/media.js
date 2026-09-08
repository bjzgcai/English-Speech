const fs = require("node:fs");
const path = require("node:path");
const processing = require("./processing");
const { mediaPipelineVersion } = require("./media-config");
// Uploaded containers must not act as playlists that open other files or URLs.
const localMediaInputOptions = ["-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,ogg,mp3,wav"];

async function inspectMedia(inputPath) {
  const probe = JSON.parse(await processing.runMedia([
    "-v", "error", ...localMediaInputOptions, "-show_streams", "-show_format", "-of", "json", inputPath,
  ], { probe: true }));
  const streams = probe.streams || [];
  const select = type => {
    const candidates = streams.filter(stream => stream.codec_type === type && !stream.disposition?.attached_pic);
    return candidates.find(stream => stream.disposition?.default) || candidates[0];
  };
  const video = select("video");
  const audio = select("audio");
  if (!video && !audio) throw new Error("The file does not contain a usable audio or video stream.");
  const duration = Number(probe.format?.duration);
  return { hasAudio: Boolean(audio), hasVideo: Boolean(video), durationSeconds: duration > 0 && Number.isFinite(duration) ? duration : null, video, audio };
}

function canCopyVideo(media, maximumDurationSeconds = 120) {
  const video = media.video;
  return Boolean(video && video.codec_name === "h264" && video.pix_fmt === "yuv420p"
    && ["Constrained Baseline", "Baseline", "Main", "High"].includes(video.profile)
    && video.level > 0 && video.level <= 41
    && video.width > 0 && video.width <= 1280 && video.width % 2 === 0
    && video.height > 0 && video.height <= 720 && video.height % 2 === 0
    && video.sample_aspect_ratio === "1:1"
    && Number(video.bit_rate) > 0 && Number(video.bit_rate) <= 2000000
    && Number.isFinite(media.durationSeconds) && media.durationSeconds <= maximumDurationSeconds
    && Math.abs(Number(video.start_time || 0)) <= 0.1
    && !Number(video.tags?.rotate || 0)
    && !(video.side_data_list || []).some(data => Number(data.rotation || 0)));
}

function frameLimit() {
  const count = Number(process.env.EVAL_MAX_FRAMES);
  return Number.isSafeInteger(count) && count > 0 ? Math.min(count, 24) : 24;
}

function audioAnalysis(output) {
  const samples = Number([...output.matchAll(/n_samples:\s*(\d+)/g)].at(-1)?.[1]);
  const durationSeconds = samples > 0 ? samples / 16000 : null;
  const maximumVolume = Number(output.match(/max_volume:\s*(-?[0-9.]+)\s*dB/i)?.[1]);
  const pauses = [...output.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)].map(match => Number(match[2]));
  return {
    durationSeconds,
    maximumVolume: Number.isFinite(maximumVolume) ? maximumVolume : null,
    detectedPauses: [...output.matchAll(/silence_start:\s*([0-9.]+)/g)].length,
    longPauses: pauses.filter(duration => duration >= 1.2).length,
    silenceSeconds: Math.round(Math.min(durationSeconds || 0, pauses.reduce((sum, duration) => sum + duration, 0)) * 10) / 10,
  };
}

function audioMetrics(analysis, transcript) {
  const wordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  return {
    durationSeconds: analysis.durationSeconds ? Math.round(analysis.durationSeconds * 10) / 10 : null,
    wordCount,
    speakingRateWpm: analysis.durationSeconds ? Math.round(wordCount * 60 / analysis.durationSeconds) : null,
    detectedPauses: analysis.detectedPauses,
    longPauses: analysis.longPauses,
    silenceSeconds: analysis.silenceSeconds,
  };
}

async function processMedia(inputPath, { outputPath = null, artifactBaseDir = null, mediaInfo, maximumDurationSeconds = 120 } = {}) {
  const media = mediaInfo || await inspectMedia(inputPath);
  const copyVideo = canCopyVideo(media, maximumDurationSeconds);
  const filters = [];
  const args = ["-y", ...localMediaInputOptions, "-i", inputPath];
  const frames = artifactBaseDir && media.hasVideo;
  const videoSource = media.hasVideo ? `0:${media.video.index}` : null;
  const audioSource = media.hasAudio ? `0:${media.audio.index}` : null;
  let normalizedVideo = videoSource;
  let frameSource = videoSource;
  if (outputPath && media.hasVideo && !copyVideo) {
    if (frames) {
      filters.push(`[${videoSource}]split=2[store][sample]`);
      normalizedVideo = "store";
      frameSource = "sample";
    }
    filters.push(`[${normalizedVideo}]scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[normalized]`);
    normalizedVideo = "[normalized]";
  }
  let frameDir;
  if (artifactBaseDir) {
    if (!media.hasAudio) throw new Error("The recording has no usable microphone audio.");
    fs.mkdirSync(artifactBaseDir, { recursive: true, mode: 0o700 });
    filters.push(`[${audioSource}]atrim=duration=${maximumDurationSeconds},aresample=16000,aformat=channel_layouts=mono,silencedetect=n=-35dB:d=0.7,volumedetect[analysis]`);
    if (frames) {
      frameDir = path.join(artifactBaseDir, "frames");
      fs.mkdirSync(frameDir, { recursive: true, mode: 0o700 });
      for (const file of fs.readdirSync(frameDir)) if (/^frame-\d+\.jpg$/.test(file)) fs.unlinkSync(path.join(frameDir, file));
      const interval = Math.max(5, Math.min(media.durationSeconds || maximumDurationSeconds, maximumDurationSeconds) / frameLimit());
      filters.push(`[${frameSource}]fps=1/${interval}:round=up:start_time=0,scale=640:-2:force_original_aspect_ratio=decrease[frames]`);
    }
  }
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  if (outputPath) {
    if (media.hasVideo) {
      args.push("-map", normalizedVideo, "-c:v", copyVideo ? "copy" : "libx264");
      if (!copyVideo) args.push("-preset", "veryfast", "-threads:v", "1", "-maxrate", "2M", "-bufsize", "4M", "-pix_fmt", "yuv420p");
    }
    if (media.hasAudio) args.push("-map", audioSource, "-c:a", "aac", "-threads:a", "1");
    args.push("-t", String(maximumDurationSeconds), "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", outputPath);
  }
  if (artifactBaseDir) {
    args.push("-map", "[analysis]", "-t", String(maximumDurationSeconds), "-c:a", "libmp3lame", "-threads:a", "1", "-ac", "1", "-ar", "16000", "-b:a", "64k", path.join(artifactBaseDir, "audio.mp3"));
    if (frames) args.push("-map", "[frames]", "-t", String(maximumDurationSeconds), "-frames:v", String(frameLimit()), "-q:v", "4", "-threads:v", "1", path.join(frameDir, "frame-%03d.jpg"));
  }
  const output = await processing.runMedia(args);
  const analysis = artifactBaseDir ? audioAnalysis(output) : null;
  const framePaths = frameDir ? fs.readdirSync(frameDir).filter(file => /^frame-\d+\.jpg$/.test(file)).sort().map(file => path.join(frameDir, file)) : [];
  return {
    pipelineVersion: mediaPipelineVersion,
    normalization: media.hasVideo ? (copyVideo ? "copy" : "h264") : "audio-only",
    prepared: artifactBaseDir ? { analysis, audibleAudio: analysis.maximumVolume !== null && analysis.maximumVolume >= -50, framePaths } : null,
  };
}

function preparedMediaExists(artifactBaseDir, prepared) {
  return Boolean(prepared?.analysis && Array.isArray(prepared.framePaths)
    && [path.join(artifactBaseDir, "audio.mp3"), ...prepared.framePaths].every(file => {
      try { return fs.statSync(file).size > 0; } catch { return false; }
    }));
}

async function convertToMp4(inputPath, outputPath, options = {}) {
  return processMedia(inputPath, { ...options, outputPath });
}

async function normalizeRecording(inputPath, outputPath, options = {}) {
  try {
    return await processMedia(inputPath, { ...options, outputPath });
  } catch (error) {
    processing.context.getStore()?.signal.throwIfAborted();
    // A frame/audio artifact failure must not discard an otherwise valid recording.
    return { ...await convertToMp4(inputPath, outputPath, { ...options, artifactBaseDir: null }), artifactFallback: true };
  }
}

module.exports = { inspectMedia, canCopyVideo, processMedia, convertToMp4, normalizeRecording, audioAnalysis, audioMetrics, preparedMediaExists };
