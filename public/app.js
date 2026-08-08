const form = document.querySelector("#search-form");
const input = document.querySelector("#search-query");
const status = document.querySelector("#search-status");
const results = document.querySelector("#search-results");
const submitButton = form.querySelector("button[type=submit]");

function setStatus(message) {
  status.textContent = message;
}

function renderResults(items) {
  results.replaceChildren();

  for (const item of items) {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    button.textContent = item.title;
    button.addEventListener("click", () => {
      setStatus(`${item.title} selected. Episode selection is next.`);
    });
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
