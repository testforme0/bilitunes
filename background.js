const BILIBILI_VIDEO_URL = /^https:\/\/www\.bilibili\.com\/video\/.+/;
const QUALITY_LABELS = {
  30216: "64K",
  30232: "132K",
  30280: "192K",
  30250: "DOLBY",
  30251: "HiRes",
};

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
      func: extractPageContext,
    });

    const resolved = await resolveAudioFromContext(result, tab.url);
    if (!resolved.ok) {
      await saveDebugLog({
        stage: resolved.stage || "resolve",
        url: tab.url,
        error: resolved.error,
        pageContext: result,
      });
      console.warn("BiliTune:", resolved.error, resolved);
      flashBadge(tab.id, "ERR", "#b91c1c");
      return;
    }

    await chrome.downloads.download({
      url: resolved.url,
      filename: resolved.fileName,
      conflictAction: "uniquify",
      saveAs: false,
    });

    if (resolved.coverUrl && resolved.coverFileName) {
      await chrome.downloads.download({
        url: resolved.coverUrl,
        filename: resolved.coverFileName,
        conflictAction: "uniquify",
        saveAs: false,
      });
    }

    await saveDebugLog({
      stage: "success",
      url: tab.url,
      result: {
        fileName: resolved.fileName,
        quality: resolved.quality,
        source: resolved.source,
      },
      pageContext: result,
    });

    flashBadge(tab.id, "OK", "#15803d");
  } catch (error) {
    await saveDebugLog({
      stage: "exception",
      url: tab.url,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("BiliTune failed:", error);
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

async function saveDebugLog(entry) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  try {
    await chrome.storage.local.set({ lastRun: payload });
  } catch (error) {
    console.warn("BiliTune: failed to persist debug log", error);
  }
}

async function resolveAudioFromContext(pageContext, pageUrl) {
  if (!pageContext?.ok) {
    return {
      ok: false,
      stage: "extract",
      error: pageContext?.error || "Failed to extract page context.",
    };
  }

  const directStream = pickAudioStream(pageContext.playInfo);
  if (directStream?.url) {
    return finalizeResolvedAudio(pageContext, directStream, "page");
  }

  let resolvedBvid = pageContext.bvid || null;
  let resolvedCid = pageContext.cid || null;

  if (resolvedBvid && !resolvedCid) {
    const viewResult = await fetchViewInfo(resolvedBvid, pageUrl);
    if (!viewResult.ok) {
      return {
        ok: false,
        stage: viewResult.stage || "view-api",
        error: viewResult.error,
      };
    }

    resolvedCid = viewResult.cid;
  }

  if (!resolvedBvid || !resolvedCid) {
    return {
      ok: false,
      stage: "identify",
      error: "Could not determine bvid/cid for fallback audio request.",
      details: {
        bvid: resolvedBvid,
        cid: resolvedCid,
        pageUrl,
      },
    };
  }

  try {
    const apiUrl = new URL("https://api.bilibili.com/x/player/playurl");
    apiUrl.searchParams.set("bvid", resolvedBvid);
    apiUrl.searchParams.set("cid", String(resolvedCid));
    apiUrl.searchParams.set("fnval", "4048");
    apiUrl.searchParams.set("fourk", "1");

    const response = await fetch(apiUrl.toString(), {
      headers: {
        Referer: pageUrl,
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        stage: "fallback-request",
        error: `Fallback API request failed with status ${response.status}.`,
      };
    }

    const payload = await response.json();
    if (payload.code !== 0) {
      return {
        ok: false,
        stage: "fallback-response",
        error: `Fallback API returned code ${payload.code}: ${payload.message || "unknown error"}.`,
      };
    }

    const apiStream = pickAudioStream({ data: payload.data });
    if (!apiStream?.url) {
      return {
        ok: false,
        stage: "fallback-audio",
        error: "Fallback API returned no usable audio stream.",
      };
    }

    return finalizeResolvedAudio(pageContext, apiStream, "playurl-api");
  } catch (error) {
    return {
      ok: false,
      stage: "fallback-exception",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchViewInfo(bvid, pageUrl) {
  try {
    const apiUrl = new URL("https://api.bilibili.com/x/web-interface/view");
    apiUrl.searchParams.set("bvid", bvid);

    const response = await fetch(apiUrl.toString(), {
      headers: {
        Referer: pageUrl,
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        stage: "view-request",
        error: `View API request failed with status ${response.status}.`,
      };
    }

    const payload = await response.json();
    if (payload.code !== 0 || !payload.data) {
      return {
        ok: false,
        stage: "view-response",
        error: `View API returned code ${payload.code}: ${payload.message || "unknown error"}.`,
      };
    }

    return {
      ok: true,
      cid: payload.data.cid || payload.data.pages?.[0]?.cid || null,
    };
  } catch (error) {
    return {
      ok: false,
      stage: "view-exception",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function finalizeResolvedAudio(pageContext, stream, source) {
  const targetFileName = `${pageContext.fileStem}.${stream.extension}`;
  const coverFileName = pageContext.cover ? `${pageContext.fileStem}-cover.${pageContext.cover.extension}` : null;

  console.info(
    `BiliTune: resolved ${targetFileName} (${QUALITY_LABELS[stream.qualityId] || stream.qualityId}) via ${source}`
  );

  return {
    ok: true,
    url: stream.url,
    fileName: targetFileName,
    coverUrl: pageContext.cover?.url || null,
    coverFileName,
    quality: QUALITY_LABELS[stream.qualityId] || String(stream.qualityId),
    source,
  };
}

function pickAudioStream(playInfo) {
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
}

function extractPageContext() {
  const sanitizeFileName = (value) =>
    value
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const parseJsonAssignment = (name) => {
    const scripts = Array.from(document.scripts);

    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text.includes(`${name}=`)) {
        continue;
      }

      const match = text.match(new RegExp(`${name}=(.*?)(?:<\\/script>|;$)`, "s"));
      if (!match) {
        continue;
      }

      try {
        return JSON.parse(match[1].replace(/;$/, ""));
      } catch {
        continue;
      }
    }

    return null;
  };

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

  const extractIdentifiers = (initialState) => {
    const bvidFromUrl = location.pathname.match(/\/video\/([^/?]+)/)?.[1] || null;
    const currentPage = Number(initialState?.p || 1);
    const pageCid =
      Array.isArray(initialState?.videoData?.pages) && currentPage > 0
        ? initialState.videoData.pages[currentPage - 1]?.cid
        : null;
    const bvid =
      initialState?.bvid ||
      initialState?.videoData?.bvid ||
      initialState?.epInfo?.bvid ||
      bvidFromUrl;

    const cid =
      initialState?.videoData?.cid ||
      pageCid ||
      initialState?.cid ||
      initialState?.epInfo?.cid;

    return { bvid, cid };
  };

  try {
    const playInfo = window.__playinfo__ || parseJsonAssignment("window.__playinfo__");
    const initialState = window.__INITIAL_STATE__ || parseJsonAssignment("window.__INITIAL_STATE__");
    const { bvid, cid } = extractIdentifiers(initialState);

    const titleNode = document.querySelector("h1[title]");
    const rawTitle =
      titleNode?.getAttribute("title") ||
      initialState?.videoData?.title ||
      initialState?.h1Title ||
      document.title.replace(/_哔哩哔哩_bilibili$/, "");

    const fileStem = sanitizeFileName(rawTitle || "bilibili_audio");
    const cover = pickCoverInfo();

    return {
      ok: true,
      href: location.href,
      fileStem,
      bvid,
      cid,
      cover,
      hasPlayInfo: Boolean(playInfo),
      hasInitialState: Boolean(initialState),
      playInfo,
      initialStateHints: initialState
        ? {
            hasVideoData: Boolean(initialState.videoData),
            hasEpInfo: Boolean(initialState.epInfo),
            p: initialState.p || null,
          }
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      href: location.href,
    };
  }
}
