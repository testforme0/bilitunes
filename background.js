const BILIBILI_VIDEO_URL = /^https:\/\/www\.bilibili\.com\/video\/.+/;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !BILIBILI_VIDEO_URL.test(tab.url)) {
    if (tab.id) {
      flashBadge(tab.id, "NO", "#6b7280");
    }
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAudioInfo,
    });

    if (!result?.ok) {
      console.warn("Bilibili Audio Extractor:", result?.error || "Unknown error");
      flashBadge(tab.id, "ERR", "#b91c1c");
      return;
    }

    await chrome.downloads.download({
      url: result.url,
      filename: result.fileName,
      conflictAction: "uniquify",
      saveAs: false,
    });

    if (result.coverUrl && result.coverFileName) {
      await chrome.downloads.download({
        url: result.coverUrl,
        filename: result.coverFileName,
        conflictAction: "uniquify",
        saveAs: false,
      });
    }

    flashBadge(tab.id, "OK", "#15803d");
  } catch (error) {
    console.error("Bilibili Audio Extractor failed:", error);
    flashBadge(tab.id, "ERR", "#b91c1c");
  }
});

function flashBadge(tabId, text, color) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });

  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" });
  }, 2500);
}

function extractAudioInfo() {
  const QUALITY_LABELS = {
    30216: "64K",
    30232: "132K",
    30280: "192K",
    30250: "DOLBY",
    30251: "HiRes",
  };

  const sanitizeFileName = (value) =>
    value
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const pickCoverInfo = () => {
    const metaImage = document.querySelector('meta[itemprop="image"]');
    const rawUrl = metaImage?.getAttribute("content");
    if (!rawUrl) {
      return null;
    }

    const normalizedUrl = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;

    try {
      const url = new URL(normalizedUrl, location.href);
      const pathname = url.pathname.toLowerCase();
      const extensionMatch = pathname.match(/\.([a-z0-9]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : "jpg";
      return {
        url: url.toString(),
        extension,
      };
    } catch {
      return {
        url: normalizedUrl,
        extension: "jpg",
      };
    }
  };

  const parsePlayInfo = () => {
    const scripts = Array.from(document.scripts);

    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes("window.__playinfo__=")) {
        continue;
      }

      const match = text.match(/window\.__playinfo__=(.*)$/s);
      if (!match) {
        continue;
      }

      return JSON.parse(match[1]);
    }

    return null;
  };

  const pickAudioStream = (playInfo) => {
    const dash = playInfo?.data?.dash;
    if (!dash) {
      return null;
    }

    if (dash.flac?.audio) {
      return {
        url: dash.flac.audio.baseUrl || dash.flac.audio.base_url,
        qualityId: dash.flac.audio.id,
        extension: "flac",
      };
    }

    if (Array.isArray(dash.dolby?.audio) && dash.dolby.audio.length > 0) {
      const dolby = dash.dolby.audio[0];
      return {
        url:
          dolby.baseUrl ||
          dolby.base_url ||
          dolby.backupUrl?.[0] ||
          dolby.backup_url?.[0],
        qualityId: dolby.id,
        extension: "ec3",
      };
    }

    if (Array.isArray(dash.audio) && dash.audio.length > 0) {
      const audio = dash.audio[0];
      return {
        url:
          audio.baseUrl ||
          audio.base_url ||
          audio.backupUrl?.[0] ||
          audio.backup_url?.[0],
        qualityId: audio.id,
        extension: "m4a",
      };
    }

    return null;
  };

  try {
    const playInfo = parsePlayInfo();
    if (!playInfo) {
      return {
        ok: false,
        error: "No play info found on this page.",
      };
    }

    const stream = pickAudioStream(playInfo);
    if (!stream?.url) {
      return {
        ok: false,
        error: "No audio stream available for this video.",
      };
    }

    const titleNode = document.querySelector("h1[title]");
    const rawTitle = titleNode?.getAttribute("title") || document.title.replace(/_哔哩哔哩_bilibili$/, "");
    const fileName = sanitizeFileName(rawTitle || "bilibili_audio");
    const targetFileName = `${fileName}.${stream.extension}`;
    const cover = pickCoverInfo();
    const coverFileName = cover ? `${fileName}-cover.${cover.extension}` : null;

    console.info(
      `Bilibili Audio Extractor: resolved ${targetFileName} (${QUALITY_LABELS[stream.qualityId] || stream.qualityId})`
    );

    return {
      ok: true,
      url: stream.url,
      fileName: targetFileName,
      coverUrl: cover?.url || null,
      coverFileName,
      quality: QUALITY_LABELS[stream.qualityId] || String(stream.qualityId),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
