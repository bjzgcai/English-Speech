(() => {
  const evaluations = new Map();

  function getDimensions(evaluation) {
    const rubric = evaluation?.rubric || {};
    return [
      rubric.pronunciation,
      rubric.fluency,
      rubric.grammar,
      rubric.vocabulary,
      rubric.coherence,
      rubric.visualDelivery,
    ].filter((item) => item && item.available !== false && Number.isFinite(Number(item.score)));
  }

  function scoreBand(score) {
    if (score >= 90) return "Exceptional";
    if (score >= 80) return "Strong";
    if (score >= 70) return "Competent";
    if (score >= 60) return "Developing";
    return "Keep building";
  }

  function dimensionLabel(label) {
    const labels = {
      "Pronunciation / intelligibility": "Pronunciation",
      "Coherence / task relevance": "Coherence",
      "Coherence / speech consistency": "Coherence",
    };
    return labels[label] || label || "Dimension";
  }

  function roundedRect(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.arcTo(x + width, y, x + width, y + height, corner);
    context.arcTo(x + width, y + height, x, y + height, corner);
    context.arcTo(x, y + height, x, y, corner);
    context.arcTo(x, y, x + width, y, corner);
    context.closePath();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to create the QR code."));
      image.src = src;
    });
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to create the share image."));
      }, "image/png");
    });
  }

  async function createImage(evaluation) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create the share image.");

    const font = '"Avenir Next", Avenir, "Segoe UI", sans-serif';
    const score = Math.round(Number(evaluation.overallScore || 0));
    const dimensions = getDimensions(evaluation);
    const qrImage = await loadImage("/api/share-qr?v=1");

    context.fillStyle = "#F2F4EF";
    context.fillRect(0, 0, canvas.width, canvas.height);

    roundedRect(context, 54, 54, 972, 1242, 24);
    context.fillStyle = "#FBFCF8";
    context.fill();

    roundedRect(context, 104, 104, 58, 58, 12);
    context.fillStyle = "#17201B";
    context.fill();
    context.fillStyle = "#FFFFFF";
    context.font = `800 28px ${font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("E", 133, 134);

    context.textAlign = "left";
    context.fillStyle = "#17201B";
    context.font = `750 27px ${font}`;
    context.fillText("OScanner-Eng", 184, 135);
    context.fillStyle = "#5D685F";
    context.font = `650 20px ${font}`;
    context.fillText("SPEAKING EVALUATION", 104, 226);

    context.fillStyle = "#17201B";
    context.font = `800 154px ${font}`;
    context.textBaseline = "alphabetic";
    context.fillText(String(score), 96, 410);
    const scoreWidth = context.measureText(String(score)).width;
    context.fillStyle = "#5D685F";
    context.font = `700 35px ${font}`;
    context.fillText("/ 100", 110 + scoreWidth, 404);

    roundedRect(context, 735, 286, 198, 62, 12);
    context.fillStyle = "#E4E9E2";
    context.fill();
    context.fillStyle = "#0D4E3B";
    context.font = `800 23px ${font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(scoreBand(score), 834, 318);

    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fillStyle = "#CCD4CC";
    context.fillRect(104, 458, 872, 2);

    dimensions.forEach((dimension, index) => {
      const y = 518 + index * 82;
      const dimensionScore = Math.max(0, Math.min(100, Number(dimension.score || 0)));
      context.fillStyle = "#17201B";
      context.font = `700 24px ${font}`;
      context.fillText(dimensionLabel(dimension.label), 104, y);
      context.fillStyle = "#5D685F";
      context.font = `750 22px ${font}`;
      context.textAlign = "right";
      context.fillText(String(Math.round(dimensionScore)), 976, y);
      context.textAlign = "left";

      roundedRect(context, 104, y + 20, 872, 12, 6);
      context.fillStyle = "#E4E9E2";
      context.fill();
      if (dimensionScore > 0) {
        roundedRect(context, 104, y + 20, 872 * (dimensionScore / 100), 12, 6);
        context.fillStyle = "#176B53";
        context.fill();
      }
    });

    context.fillStyle = "#CCD4CC";
    context.fillRect(104, 1030, 872, 2);
    context.fillStyle = "#17201B";
    context.font = `800 34px ${font}`;
    context.fillText("How clear is your English?", 104, 1104);
    context.fillStyle = "#5D685F";
    context.font = `600 23px ${font}`;
    context.fillText("Scan to examine your spoken response.", 104, 1146);
    context.fillStyle = "#0D4E3B";
    context.font = `750 22px ${font}`;
    context.fillText(window.location.host, 104, 1194);

    roundedRect(context, 774, 1063, 202, 202, 12);
    context.fillStyle = "#FFFFFF";
    context.fill();
    context.drawImage(qrImage, 785, 1074, 180, 180);

    return canvasBlob(canvas);
  }

  function saveImage(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function contextFor(button) {
    const shareBlock = button.closest(".evaluation-share");
    return {
      evaluation: evaluations.get(button.dataset.shareId),
      feedback: shareBlock?.querySelector(".share-feedback"),
      buttons: shareBlock?.querySelectorAll("button") || [button],
    };
  }

  async function share(button) {
    const { evaluation, feedback, buttons } = contextFor(button);
    if (!evaluation) {
      if (feedback) feedback.textContent = "This evaluation is no longer available.";
      return;
    }

    buttons.forEach((item) => { item.disabled = true; });
    if (feedback) feedback.textContent = "Creating image…";
    try {
      const blob = await createImage(evaluation);
      const score = Math.round(Number(evaluation.overallScore || 0));
      const file = new File([blob], `english-evaluation-${score}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        if (feedback) feedback.textContent = "Image shared.";
      } else {
        saveImage(file);
        if (feedback) feedback.textContent = "Image saved. You can share it anywhere.";
      }
    } catch (error) {
      if (error?.name !== "AbortError" && feedback) {
        feedback.textContent = error.message || "Unable to share this evaluation.";
      } else if (feedback) {
        feedback.textContent = "";
      }
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
    }
  }

  async function copy(button) {
    const { evaluation, feedback, buttons } = contextFor(button);
    if (!evaluation) {
      if (feedback) feedback.textContent = "This evaluation is no longer available.";
      return;
    }

    buttons.forEach((item) => { item.disabled = true; });
    if (feedback) feedback.textContent = "Creating image…";
    try {
      const blob = await createImage(evaluation);
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        const score = Math.round(Number(evaluation.overallScore || 0));
        saveImage(new File([blob], `english-evaluation-${score}.png`, { type: "image/png" }));
        if (feedback) feedback.textContent = "Clipboard images are not supported here, so the image was saved instead.";
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      if (feedback) feedback.textContent = "One image copied.";
    } catch (error) {
      if (feedback) feedback.textContent = error.message || "Unable to copy this evaluation.";
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
    }
  }

  window.EvaluationShare = {
    register(id, evaluation) {
      if (id && evaluation) evaluations.set(String(id), evaluation);
    },
    handleClick(event) {
      const shareButton = event.target.closest(".share-evaluation");
      if (shareButton) {
        share(shareButton);
        return true;
      }
      const copyButton = event.target.closest(".copy-evaluation");
      if (copyButton) {
        copy(copyButton);
        return true;
      }
      return false;
    },
  };
})();
