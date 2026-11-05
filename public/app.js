const form = document.querySelector("#search-form");
const input = document.querySelector("#search-query");
const lastViewed = document.querySelector("#last-viewed");
const lastViewedLink = document.querySelector("#last-viewed-link");
const status = document.querySelector("#search-status");
const results = document.querySelector("#search-results");
const episodesPanel = document.querySelector("#episodes-panel");
const episodes = document.querySelector("#episode-results");
const playerPanel = document.querySelector("#player-panel");
const playerTitle = document.querySelector("#player-title");
const video = document.querySelector("#video-player");
const playerStatus = document.querySelector("#player-status");
const qualityControl = document.querySelector("#player-quality-control");
const qualitySelect = document.querySelector("#player-quality");
const episodeNav = document.querySelector("#episode-nav");
const previousEpisodeButton = document.querySelector("#previous-episode");
const nextEpisodeButton = document.querySelector("#next-episode");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");
const preferredQualitySelect = document.querySelector("#preferred-quality");
const submitButton = form.querySelector("button[type=submit]");
const LAST_VIEWED_KEY = "anilan:last-viewed";
const PREFERRED_QUALITY_KEY = "anilan:preferred-quality";
let episodeRequest = 0;
let resolutionRequest = 0;
let currentPlayback = null;
let pendingSeek = null;

function setStatus(message) {
  status.textContent = message;
}

function setBusy(element, busy) {
  element.setAttribute("aria-busy", String(busy));
}

function readLastViewed() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY));

    if (
      !saved ||
      typeof saved.id !== "string" ||
      typeof saved.title !== "string" ||
      !Number.isInteger(saved.episode) ||
      saved.episode < 1
    ) {
      return null;
    }

    return saved;
  } catch {
    return null;
  }
}

function saveLastViewed(anime, episode) {
  try {
    localStorage.setItem(
      LAST_VIEWED_KEY,
      JSON.stringify({ id: anime.id, title: anime.title, episode })
    );
  } catch {
    // Local storage may be disabled, but playback should still work.
  }
  renderLastViewed();
}

function renderLastViewed() {
  const saved = readLastViewed();
  lastViewed.hidden = !saved;

  if (saved) {
    lastViewedLink.textContent = `${saved.title} - Episode ${saved.episode}`;
  }
}

function readPreferredQuality() {
  try {
    const saved = localStorage.getItem(PREFERRED_QUALITY_KEY);
    return [...preferredQualitySelect.options].some((option) => option.value === saved) ? saved : "";
  } catch {
    return "";
  }
}

function savePreferredQuality(quality) {
  try {
    localStorage.setItem(PREFERRED_QUALITY_KEY, quality);
  } catch {
    // Local storage may be disabled, but the preference still applies on this page.
  }
}

function hidePlayer() {
  video.pause();
  clearSubtitleTracks();
  video.removeAttribute("src");
  video.load();
  playerPanel.hidden = true;
  setBusy(playerPanel, false);
  playerTitle.textContent = "";
  playerStatus.textContent = "";
  currentPlayback = null;
  pendingSeek = null;
  qualityControl.hidden = true;
  episodeNav.hidden = true;
}

function clearSubtitleTracks() {
  video.querySelectorAll("track").forEach((track) => track.remove());
}

function addSubtitleTrack(url) {
  if (typeof url !== "string" || url.length === 0) {
    return;
  }

  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = "English";
  track.srclang = "en";
  track.src = url;
  track.default = true;
  video.append(track);
}

async function fetchEpisodeStream(anime, episode, quality) {
  const query = quality ? `?quality=${encodeURIComponent(quality)}` : "";
  const response = await fetch(`/api/anime/${encodeURIComponent(anime.id)}/episode/${episode}${query}`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? "Could not resolve this episode.");
  }

  return body;
}

function loadStream(anime, body, { resumeAt = null, autoplay = false } = {}) {
  currentPlayback = { anime, episode: body.episode, quality: body.quality };
  playerTitle.textContent = `${body.title} - Episode ${body.episode}`;
  clearSubtitleTracks();
  addSubtitleTrack(body.subtitleUrl);
  renderQualities(body.qualities ?? [], body.quality);
  renderEpisodeNav();
  pendingSeek = resumeAt;
  video.src = body.streamUrl;
  video.load();

  if (autoplay) {
    void video.play().catch(() => {
      // Browsers may block autoplay after a source change; the viewer can press play.
    });
  }
}

function renderQualities(qualities, selected) {
  qualitySelect.replaceChildren(...qualities.map((quality) => new Option(quality, quality)));
  qualitySelect.value = selected ?? "";
  qualitySelect.disabled = false;
  qualityControl.hidden = qualities.length < 2;
}

function renderEpisodeNav() {
  const { anime, episode } = currentPlayback;
  const index = anime.episodes.findIndex((item) => item.number === episode);

  episodeNav.hidden = anime.episodes.length < 2;
  previousEpisodeButton.disabled = index <= 0;
  nextEpisodeButton.disabled = index === -1 || index === anime.episodes.length - 1;
}

function openAdjacentEpisode(offset) {
  if (!currentPlayback) {
    return;
  }

  const { anime, episode } = currentPlayback;
  const index = anime.episodes.findIndex((item) => item.number === episode);
  const target = index === -1 ? undefined : anime.episodes[index + offset];

  if (target) {
    void resolveEpisode(anime, target.number);
  }
}

async function changeQuality(quality) {
  if (!currentPlayback) {
    return;
  }

  const { anime, episode } = currentPlayback;
  const requestNumber = ++resolutionRequest;
  const resumeAt = video.currentTime;
  const wasPlaying = !video.paused;
  qualitySelect.disabled = true;
  playerStatus.textContent = `Switching to ${quality}...`;

  try {
    const body = await fetchEpisodeStream(anime, episode, quality);

    if (requestNumber !== resolutionRequest) {
      return;
    }

    loadStream(anime, body, { resumeAt, autoplay: wasPlaying });
    playerStatus.textContent = body.quality ? `Switched to ${body.quality}.` : "Stream ready.";
  } catch (error) {
    if (requestNumber === resolutionRequest) {
      playerStatus.textContent = error instanceof Error ? error.message : "Could not switch resolution.";
      qualitySelect.value = currentPlayback.quality ?? "";
      qualitySelect.disabled = false;
    }
  }
}

async function resolveEpisode(anime, episode) {
  const requestNumber = ++resolutionRequest;
  hidePlayer();
  setBusy(episodesPanel, true);
  setStatus(`Resolving ${anime.title}, episode ${episode}...`);
  playerStatus.textContent = "Resolving stream...";

  try {
    const body = await fetchEpisodeStream(anime, episode, preferredQualitySelect.value);

    if (requestNumber !== resolutionRequest) {
      return;
    }

    loadStream(anime, body);
    playerPanel.hidden = false;
    setBusy(playerPanel, false);
    playerStatus.textContent = "Stream ready. Press play to watch.";
    saveLastViewed(anime, episode);
    setStatus(playerTitle.textContent);
    playerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (requestNumber === resolutionRequest) {
      setStatus(error instanceof Error ? error.message : "Could not resolve this episode.");
      playerStatus.textContent = "Could not load this episode.";
    }
  } finally {
    if (requestNumber === resolutionRequest) {
      setBusy(episodesPanel, false);
    }
  }
}

video.addEventListener("error", () => {
  playerStatus.textContent = "This stream cannot be played directly in this browser.";
});

video.addEventListener("loadedmetadata", () => {
  if (pendingSeek !== null) {
    video.currentTime = pendingSeek;
    pendingSeek = null;
  }
});

qualitySelect.addEventListener("change", () => void changeQuality(qualitySelect.value));
previousEpisodeButton.addEventListener("click", () => openAdjacentEpisode(-1));
nextEpisodeButton.addEventListener("click", () => openAdjacentEpisode(1));

settingsToggle.addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsToggle.setAttribute("aria-expanded", String(!settingsPanel.hidden));
});

preferredQualitySelect.addEventListener("change", () => {
  savePreferredQuality(preferredQualitySelect.value);
});

lastViewedLink.addEventListener("click", (event) => {
  event.preventDefault();
  const saved = readLastViewed();

  if (!saved) {
    renderLastViewed();
    return;
  }

  void selectAnime(saved, saved.episode);
});

function renderEpisodes(anime) {
  episodes.replaceChildren();

  for (const episode of anime.episodes) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    button.textContent = `Episode ${episode.number}`;
    button.addEventListener("click", () => void resolveEpisode(anime, episode.number));
    listItem.append(button);
    episodes.append(listItem);
  }

  episodesPanel.hidden = false;
}

async function selectAnime(item, episodeToResolve) {
  const requestNumber = ++episodeRequest;
  resolutionRequest += 1;
  hidePlayer();
  episodesPanel.hidden = true;
  episodes.replaceChildren();
  setBusy(episodesPanel, true);
  setStatus(`Loading episodes for ${item.title}...`);

  try {
    const response = await fetch(`/api/anime/${encodeURIComponent(item.id)}`);
    const body = await response.json();

    if (requestNumber !== episodeRequest) {
      return;
    }
    if (!response.ok) {
      throw new Error(body.error ?? "Could not load episodes.");
    }

    renderEpisodes(body);
    setStatus(`${body.title}: ${body.episodes.length} episode${body.episodes.length === 1 ? "" : "s"}.`);

    if (episodeToResolve !== undefined) {
      await resolveEpisode(body, episodeToResolve);
    }
  } catch (error) {
    if (requestNumber === episodeRequest) {
      setStatus(error instanceof Error ? error.message : "Could not load episodes.");
    }
  } finally {
    if (requestNumber === episodeRequest) {
      setBusy(episodesPanel, false);
    }
  }
}

function renderResults(items) {
  results.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No anime found.";
    results.append(empty);
    return;
  }

  for (const item of items) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    button.textContent = item.title;
    button.addEventListener("click", () => void selectAnime(item));
    listItem.append(button);
    results.append(listItem);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = input.value.trim();
  if (!query) {
    setStatus("Enter an anime name to search.");
    return;
  }

  submitButton.disabled = true;
  setBusy(form, true);
  setStatus("Searching...");
  results.replaceChildren();
  episodesPanel.hidden = true;
  episodes.replaceChildren();
  episodeRequest += 1;
  resolutionRequest += 1;
  hidePlayer();
  setBusy(episodesPanel, false);

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? "Could not search anime.");
    }

    const foundResults = Array.isArray(body.results) ? body.results : [];
    renderResults(foundResults);
    setStatus(`${foundResults.length} result${foundResults.length === 1 ? "" : "s"} found.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not search anime.");
  } finally {
    submitButton.disabled = false;
    setBusy(form, false);
  }
});

preferredQualitySelect.value = readPreferredQuality();
renderLastViewed();
