const form = document.querySelector("#search-form");
const input = document.querySelector("#search-query");
const status = document.querySelector("#search-status");
const results = document.querySelector("#search-results");
const episodesPanel = document.querySelector("#episodes-panel");
const episodes = document.querySelector("#episode-results");
const playerPanel = document.querySelector("#player-panel");
const playerTitle = document.querySelector("#player-title");
const video = document.querySelector("#video-player");
const playerStatus = document.querySelector("#player-status");
const submitButton = form.querySelector("button[type=submit]");
let episodeRequest = 0;
let resolutionRequest = 0;

function setStatus(message) {
  status.textContent = message;
}

function setBusy(element, busy) {
  element.setAttribute("aria-busy", String(busy));
}

function hidePlayer() {
  video.pause();
  video.removeAttribute("src");
  video.load();
  playerPanel.hidden = true;
  setBusy(playerPanel, false);
  playerTitle.textContent = "";
  playerStatus.textContent = "";
}

async function resolveEpisode(anime, episode) {
  const requestNumber = ++resolutionRequest;
  hidePlayer();
  setBusy(episodesPanel, true);
  setStatus(`Resolving ${anime.title}, episode ${episode}...`);
  playerStatus.textContent = "Resolving stream...";

  try {
    const response = await fetch(`/api/anime/${encodeURIComponent(anime.id)}/episode/${episode}`);
    const body = await response.json();

    if (requestNumber !== resolutionRequest) {
      return;
    }
    if (!response.ok) {
      throw new Error(body.error ?? "Could not resolve this episode.");
    }

    playerTitle.textContent = `${body.title} - Episode ${body.episode}`;
    video.src = body.streamUrl;
    video.load();
    playerPanel.hidden = false;
    setBusy(playerPanel, false);
    playerStatus.textContent = "Stream ready. Press play to watch.";
    setStatus(playerTitle.textContent);
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

async function selectAnime(item) {
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
