const form = document.querySelector("#search-form");
const input = document.querySelector("#search-query");
const status = document.querySelector("#search-status");
const results = document.querySelector("#search-results");
const episodesPanel = document.querySelector("#episodes-panel");
const episodes = document.querySelector("#episode-results");
const submitButton = form.querySelector("button[type=submit]");
let episodeRequest = 0;

function setStatus(message) {
  status.textContent = message;
}

function renderEpisodes(anime) {
  episodes.replaceChildren();

  for (const episode of anime.episodes) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    button.textContent = `Episode ${episode.number}`;
    button.addEventListener("click", () => {
      setStatus(`${anime.title}, episode ${episode.number} selected. Playback is next.`);
    });
    listItem.append(button);
    episodes.append(listItem);
  }

  episodesPanel.hidden = false;
}

async function selectAnime(item) {
  const requestNumber = ++episodeRequest;
  episodesPanel.hidden = true;
  episodes.replaceChildren();
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
  }
}

function renderResults(items) {
  results.replaceChildren();

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
  setStatus("Searching...");
  results.replaceChildren();
  episodesPanel.hidden = true;
  episodes.replaceChildren();
  episodeRequest += 1;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? "Could not search anime.");
    }

    renderResults(body.results);
    setStatus(`${body.results.length} result${body.results.length === 1 ? "" : "s"} found.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not search anime.");
  } finally {
    submitButton.disabled = false;
  }
});
