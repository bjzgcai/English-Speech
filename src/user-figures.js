// A learner may replace the default weekly task figure with their own image.
// Both the direct save-answer path and the queue worker path need the same
// validation and storage rules, so they live here once.
const fs = require("node:fs");
const path = require("node:path");

const MAX_USER_FIGURE_BYTES = 5 * 1024 * 1024;
const USER_FIGURE_EXTENSIONS = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });
const USER_FIGURE_EXTENSION_MIME = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
});
const USER_FIGURE_SRC_PREFIX = "/api/user-figures/";
const USER_FIGURE_SRC_PATTERN = /^\/api\/user-figures\/([a-z0-9][a-z0-9-]*)\.(png|jpe?g|webp)$/;

function isSupportedUserFigure(file) {
  return Boolean(file)
    && Object.prototype.hasOwnProperty.call(USER_FIGURE_EXTENSIONS, file.mimetype)
    && file.size > 0
    && file.size <= MAX_USER_FIGURE_BYTES;
}

// Resolves the stored filename ("<answer id>.<extension>") from a figure src.
function userFigureFilenameFromSrc(src) {
  const match = USER_FIGURE_SRC_PATTERN.exec(typeof src === "string" ? src : "");
  return match ? `${match[1]}.${match[2]}` : null;
}

function storeUserFigure({ answerId, uploadedFile, userFiguresDir, altName }) {
  if (!uploadedFile) return null;
  const extension = USER_FIGURE_EXTENSIONS[uploadedFile.mimetype];
  if (!extension || uploadedFile.size > MAX_USER_FIGURE_BYTES) {
    fs.rmSync(uploadedFile.path, { force: true });
    return null;
  }
  const filename = `${answerId}.${extension}`;
  const finalPath = path.join(userFiguresDir, filename);
  fs.mkdirSync(userFiguresDir, { recursive: true, mode: 0o700 });
  fs.renameSync(uploadedFile.path, finalPath);
  fs.chmodSync(finalPath, 0o600);
  return {
    src: `${USER_FIGURE_SRC_PREFIX}${filename}`,
    alt: altName || "Learner's own figure",
    caption: "Your figure",
    filename,
  };
}

// Answer ids are UUIDs and only one figure is kept per answer, so the stored
// file can be found from the id alone — needed when a queued job is canceled
// before its record (and therefore its figure src) is written.
function removeUserFigureForAnswer(answerId, userFiguresDir) {
  if (!userFiguresDir || typeof answerId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(answerId)) return;
  for (const extension of Object.values(USER_FIGURE_EXTENSIONS)) {
    fs.rmSync(path.join(userFiguresDir, `${answerId}.${extension}`), { force: true });
  }
}

module.exports = {
  MAX_USER_FIGURE_BYTES,
  USER_FIGURE_EXTENSION_MIME,
  USER_FIGURE_SRC_PATTERN,
  isSupportedUserFigure,
  removeUserFigureForAnswer,
  storeUserFigure,
  userFigureFilenameFromSrc,
};
