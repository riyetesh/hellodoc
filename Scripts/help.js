document.addEventListener('DOMContentLoaded', () => {
    // Card clicks are handled by the inline onclick handlers on each .card,
    // which open the matching popup. (The old toggleCard() expand/collapse was
    // retired with the cards' inline panels; its listener only threw.)

    // Toggle for FAQ Section
    const accordions = document.querySelectorAll('.accordion');
    
    accordions.forEach((accordion) => {
        accordion.addEventListener('click', () => {
            toggleAccordion(accordion);
        });
    });
});



// Toggle for Card section
// function toggleCard(cardElement) {
//     // Toggle the "active" class for the clicked card
//     cardElement.classList.toggle('active');

//     // Get the associated panel (collapsible content inside the card)
//     const panel = cardElement.querySelector('.collapsible-content');

//     // Toggle the display of the panel
//     if (panel.style.display === 'block') {
//         panel.style.display = 'none';
//     } else {
//         panel.style.display = 'block';
//     }
// }

// Toggle for Accordion section
function toggleAccordion(accordionElement) {
    // Toggle the "active" class for the clicked accordion
    accordionElement.classList.toggle('active');

    // Get the associated panel (collapsible content inside the accordion)
    const panel = accordionElement.nextElementSibling;

    // Toggle the display of the panel
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
    }
}







/// Pop up modal
// Function to open a modal by ID
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'flex'; // Show modal with Flexbox

    // Add event listener to close the modal when clicking outside of it
    const outsideClick = (event) => {
        if (event.target === modal) {
            closeModal(modalId);
            window.removeEventListener('click', outsideClick); // Remove listener after closing
        }
    };

    window.addEventListener('click', outsideClick);
}
// Function to close a modal by ID
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'none';
}

// Function to open a modal by ID
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'flex'; // Display as flex to center the modal
}

// Specific modal opening and closing functions
function openAccountPopup() {
    openModal('accountPopupModal');
}

function closeAccountPopup() {
    closeModal('accountPopupModal');
}

function openAppointmentPopup() {
    openModal('appointmentPopupModal');
}

function closeAppointmentPopup() {
    closeModal('appointmentPopupModal');
}

function openPrivacyPopup() {
    openModal('privacyPopupModal');
}

function closePrivacyPopup() {
    closeModal('privacyPopupModal');
}

function openTroubleshootingPopup() {
    openModal('troubleshootingPopupModal');
}

function closeTroubleshootingPopup() {
    closeModal('troubleshootingPopupModal');
}

function openAboutPopup() {
    openModal('aboutPopupModal');
}

function closeAboutPopup() {
    closeModal('aboutPopupModal');
}

function openContactPopup() {
    openModal('contactPopupModal');
}

function closeContactPopup() {
    closeModal('contactPopupModal');
}

// Close modal when clicking outside the modal content
window.onclick = function(event) {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        if (event.target === modal) {
            modal.style.display = "none"; // Close modal if clicked outside
        }
    });
}



/* ============================================================
   Search
   The help content lives in six topic cards and in the accordions
   inside their modals (there is no `.content` wrapper on this page),
   so those are what we index. Because most matching text sits inside
   something that is hidden until it is opened, choosing a suggestion
   opens the owning modal/panel, scrolls to the match and highlights it.
   ============================================================ */

const HIGHLIGHT_CLASS = "highlight";
const MAX_SUGGESTIONS = 8;

/* Characters that are special inside a regular expression. Backslash is
   added by char code so this file needs no escape-heavy literals. */
const BACKSLASH = String.fromCharCode(92);
const REGEX_SPECIALS = "^$.*+?()[]{}|" + BACKSLASH;

function escapeRegExp(value) {
  let escaped = "";
  for (const ch of value) {
    escaped += REGEX_SPECIALS.indexOf(ch) === -1 ? ch : BACKSLASH + ch;
  }
  return escaped;
}

/* Remove the highlight spans again without disturbing the real markup. */
function clearHighlights() {
  document.querySelectorAll("." + HIGHLIGHT_CLASS).forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(span.textContent), span);
    parent.normalize();
  });
}

/* Wrap every occurrence of `needle` inside `scope`. Works on text nodes
   only, so existing markup (e.g. the <strong> labels in the FAQs) survives. */
function highlightMatches(scope, needle) {
  if (!scope || !needle) return;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;

  while ((node = walker.nextNode())) {
    const probe = new RegExp(escapeRegExp(needle), "i");
    if (probe.test(node.nodeValue)) textNodes.push(node);
  }

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    const finder = new RegExp(escapeRegExp(needle), "gi");
    const frag = document.createDocumentFragment();
    let last = 0;
    let match;

    while ((match = finder.exec(text)) !== null) {
      if (match.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, match.index)));
      }
      const span = document.createElement("span");
      span.className = HIGHLIGHT_CLASS;
      span.textContent = match[0];
      frag.appendChild(span);
      last = match.index + match[0].length;
      if (match[0] === "") finder.lastIndex += 1;
    }

    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
  });
}

/* One searchable entry per topic card and per accordion item. */
function collectSearchableEntries() {
  const entries = [];

  document.querySelectorAll(".content-wrapper > .card").forEach((card) => {
    const heading = card.querySelector("h3");
    if (!heading) return;
    // The card opens its popup through an inline handler such as openAccountPopup().
    const opener = (card.getAttribute("onclick") || "").replace(/\(\s*\)$/, "");
    entries.push({
      kind: "Topic",
      label: heading.textContent.trim(),
      questionEl: heading,
      questionText: heading.textContent,
      answerEl: null,
      answerText: "",
      scrollTarget: card,
      open: () => {
        if (typeof window[opener] === "function") window[opener]();
      }
    });
  });

  document.querySelectorAll(".accordion-item").forEach((item) => {
    const button = item.querySelector(".accordion");
    const panel = item.querySelector(".collapsible-content");
    const modal = item.closest(".modal");

    entries.push({
      kind: "FAQ",
      label: (button ? button.textContent : item.textContent).trim(),
      questionEl: button || item,
      questionText: button ? button.textContent : "",
      answerEl: panel,
      answerText: panel ? panel.textContent : "",
      scrollTarget: panel && panel.textContent.trim() ? panel : item,
      open: () => {
        if (modal) {
          if (typeof window.openModal === "function") window.openModal(modal.id);
          else modal.style.display = "flex";
        }
        if (button) button.classList.add("active");
        if (panel) {
          panel.classList.add("active");
          panel.style.display = "block";
        }
      }
    });
  });

  return entries;
}

function searchContent() {
  const bar = document.getElementById("search-bar");
  const list = document.getElementById("suggestions");
  if (!bar || !list) return;

  const needle = bar.value.trim();
  clearHighlights();
  list.innerHTML = "";
  list.classList.remove("open");

  if (!needle) return;

  const lower = needle.toLowerCase();
  const matches = collectSearchableEntries()
    .map((entry) => {
      const inQuestion =
        entry.questionText.toLowerCase().includes(lower) ||
        entry.label.toLowerCase().includes(lower);
      const inAnswer = entry.answerText.toLowerCase().includes(lower);
      if (!inQuestion && !inAnswer) return null;
      return { entry, rank: inQuestion ? 0 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  // Always highlight the card titles: they are the visible part of the page.
  document
    .querySelectorAll(".content-wrapper > .card .content-section h3")
    .forEach((heading) => highlightMatches(heading, needle));

  if (matches.length === 0) {
    const empty = document.createElement("li");
    empty.className = "suggestions__empty";
    empty.textContent = 'No matches for "' + needle + '"';
    list.appendChild(empty);
    list.classList.add("open");
    return;
  }

  matches.slice(0, MAX_SUGGESTIONS).forEach(({ entry, rank }) => {
    const li = document.createElement("li");
    li.className = "suggestions__item";
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-label", entry.label);

    const title = document.createElement("span");
    title.className = "suggestions__title";
    title.textContent = entry.label;

    const meta = document.createElement("span");
    meta.className = "suggestions__meta";
    meta.textContent = rank === 0 ? entry.kind : entry.kind + " \u00b7 match in answer";

    li.appendChild(title);
    li.appendChild(meta);

    const choose = () => {
      clearHighlights();
      entry.open();
      if (entry.scrollTarget) {
        entry.scrollTarget.scrollIntoView({ block: "center" });
      }
      highlightMatches(entry.questionEl, needle);
      if (entry.answerEl) highlightMatches(entry.answerEl, needle);
      list.innerHTML = "";
      list.classList.remove("open");
    };

    li.addEventListener("click", choose);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });

    list.appendChild(li);
  });

  if (matches.length > MAX_SUGGESTIONS) {
    const more = document.createElement("li");
    more.className = "suggestions__empty";
    more.textContent = "Showing " + MAX_SUGGESTIONS + " of " + matches.length + " matches";
    list.appendChild(more);
  }

  list.classList.add("open");
}

/* Enter picks the first suggestion, Escape clears the field. */
document.addEventListener("DOMContentLoaded", () => {
  const bar = document.getElementById("search-bar");
  const list = document.getElementById("suggestions");
  if (!bar) return;

  // `input` covers typing, pasting and IME composition in one code path.
  bar.addEventListener("input", searchContent);

  bar.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      bar.value = "";
      searchContent();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const first = list ? list.querySelector(".suggestions__item") : null;
      if (first) first.click();
    }
  });

  document.addEventListener("click", (event) => {
    if (!list || !event.target.closest(".search-container")) {
      list.classList.remove("open");
    }
  });
});
