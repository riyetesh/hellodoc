document.addEventListener('DOMContentLoaded', () => {
    // Toggle for Card Section
    const cards = document.querySelectorAll('.card');
    
    cards.forEach((card) => {
        card.addEventListener('click', () => {
            toggleCard(card);
        });
    });

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




// Search logic

function searchContent() {
    const query = document.getElementById("search-bar").value.toLowerCase();
    const contentElements = document.querySelectorAll(".content p");
    const suggestionsContainer = document.getElementById("suggestions");

    suggestionsContainer.innerHTML = ""; // Clear old suggestions

    if (!query) {
        clearHighlights(contentElements);
        return;
    }

    const suggestions = new Set();

    contentElements.forEach((element) => {
        const text = element.textContent.toLowerCase();
        if (text.includes(query)) {
            suggestions.add(element.textContent);
        }
    });

    if (suggestions.size > 0) {
        suggestions.forEach((suggestion) => {
            const li = document.createElement("li");
            li.textContent = suggestion;
            li.onclick = () => {
                document.getElementById("search-bar").value = suggestion;
                highlightMatches(contentElements, suggestion.toLowerCase());
                suggestionsContainer.innerHTML = ""; // Clear suggestions
            };
            suggestionsContainer.appendChild(li);
        });
    }

    highlightMatches(contentElements, query);
}

function clearHighlights(elements) {
    elements.forEach((element) => {
        element.innerHTML = element.textContent; // Reset content
    });
}

function highlightMatches(elements, query) {
    clearHighlights(elements);

    elements.forEach((element) => {
        const text = element.textContent;
        const regex = new RegExp(`(${query})`, "gi");
        const highlightedText = text.replace(regex, "<span class='highlight'>$1</span>");
        element.innerHTML = highlightedText;
    });
}
