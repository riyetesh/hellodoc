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


function openModal(contentId) {
    // Hide the logo
    document.querySelector('.logo').style.display = 'none';

    // Show the modal
    const modal = document.getElementById(contentId);
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeModal() {
    // Show the logo again
    document.querySelector('.logo').style.display = 'inline';

    // Hide the modal
    const modal = document.querySelector('.modal-content');
    if (modal) {
        modal.style.display = 'none';
    }
}


// Toggle for Card section
function toggleCard(cardElement) {
    // Toggle the "active" class for the clicked card
    cardElement.classList.toggle('active');

    // Get the associated panel (collapsible content inside the card)
    const panel = cardElement.querySelector('.collapsible-content');

    // Toggle the display of the panel
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
    }
}

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


// Searchbar


const contentData = [
    { id: 'section-1', title: 'About Us', content: 'Our company provides quality healthcare solutions to patients around the world. We strive to make healthcare accessible and affordable.' },
    { id: 'section-2', title: 'Contact Us', content: 'For any inquiries, please contact us at info@example.com or visit our support page.' },
    { id: 'faq', title: 'FAQs', content: 'How do I create an account? How do I search for a doctor? How do I book an appointment?' }
];

// Search and Display Suggestions
function searchSuggestions() {
    const query = document.getElementById("search-bar").value.toLowerCase();
    const suggestionsContainer = document.getElementById("suggestions");
    suggestionsContainer.innerHTML = ''; // Clear previous suggestions

    if (!query) {
        suggestionsContainer.style.display = 'none'; // Hide suggestions if the input is empty
        return;
    }

    const filteredResults = contentData.filter(item => item.title.toLowerCase().includes(query) || item.content.toLowerCase().includes(query));

    if (filteredResults.length > 0) {
        suggestionsContainer.style.display = 'block';
        filteredResults.forEach(result => {
            const suggestionItem = document.createElement("div");
            suggestionItem.classList.add('suggestion-item');
            suggestionItem.textContent = result.title;
            suggestionItem.onclick = () => highlightContent(result.id, query);
            suggestionsContainer.appendChild(suggestionItem);
        });
    } else {
        suggestionsContainer.style.display = 'none';
    }
}

// Open Modal (Pop-up Window) with flip animation
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('show'); // Display the modal with flip animation
}

// Close Modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('show'); // Hide the modal
}


// Highlight the content when a suggestion is clicked
function highlightContent(id, query) {
    // Remove previous highlights
    document.querySelectorAll('.highlight').forEach((el) => {
        el.classList.remove('highlight');
        el.innerHTML = el.textContent; // Reset content to original
    });

    const section = document.getElementById(id);
    if (section) {
        const regex = new RegExp(query, 'gi');
        section.innerHTML = section.innerHTML.replace(regex, (match) => `<span class="highlight">${match}</span>`);
    }

    // Hide suggestions after selection
    document.getElementById("suggestions").style.display = 'none';
}
