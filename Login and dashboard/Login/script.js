document.addEventListener("DOMContentLoaded", function () {
  // Array to hold the doctor data
  const doctors = [
    {
      name: "Dr. Priya Shah",
      experience: "12 years",
      speciality: "General Physician",
      hourlyFee: 2500,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Ramesh Kumar",
      experience: "15 years",
      speciality: "Pediatrician",
      hourlyFee: 3000,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Ananya Gupta",
      experience: "8 years",
      speciality: "Gynecologist & Obstetrician",
      hourlyFee: 4000,
      image: "./images/gynecologist.jpeg",
    },
    {
      name: "Dr. Amit Verma",
      experience: "20 years",
      speciality: "Dermatologist",
      hourlyFee: 3500,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Vinay Singh",
      experience: "10 years",
      speciality: "Cardiologist",
      hourlyFee: 5000,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Neha Yadav",
      experience: "25 years",
      speciality: "Neurologist",
      hourlyFee: 6000,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Sunil Rao",
      experience: "7 years",
      speciality: "Orthopedic Surgeon",
      hourlyFee: 4500,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Seema Dubey",
      experience: "22 years",
      speciality: "ENT Specialist",
      hourlyFee: 4000,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Harish Mehta",
      experience: "17 years",
      speciality: "Ophthalmologist",
      hourlyFee: 3500,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Shalini Agarwal",
      experience: "9 years",
      speciality: "Psychiatrist",
      hourlyFee: 3800,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Prakash Reddy",
      experience: "18 years",
      speciality: "Endocrinologist",
      hourlyFee: 5500,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Manisha Sharma",
      experience: "14 years",
      speciality: "Pulmonologist",
      hourlyFee: 4700,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Rajesh Kumar",
      experience: "19 years",
      speciality: "Nephrologist",
      hourlyFee: 5200,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Kavita Singh",
      experience: "11 years",
      speciality: "Gastroenterologist",
      hourlyFee: 4400,
      image: "./images/gastroenterologist.jpg",
    },
    {
      name: "Dr. Tarun Mehra",
      experience: "16 years",
      speciality: "Urologist",
      hourlyFee: 5000,
      image: "./images/urologist.jpg",
    },
    {
      name: "Dr. Sanjeev Bhatt",
      experience: "21 years",
      speciality: "Oncologist",
      hourlyFee: 6000,
      image: "./images/oncologist.jpg",
    },
    {
      name: "Dr. Aditi Desai",
      experience: "24 years",
      speciality: "Hematologist",
      hourlyFee: 5500,
      image: "./images/hematologist.jpg",
    },
    {
      name: "Dr. Vikas Yadav",
      experience: "13 years",
      speciality: "Rheumatologist",
      hourlyFee: 4800,
      image: "./images/rheumatologist.jpg",
    },
    {
      name: "Dr. Rohit Malhotra",
      experience: "6 years",
      speciality: "Infectious Disease Specialist",
      hourlyFee: 3300,
      image: "./images/infectious.jpg",
    },
    {
      name: "Dr. Priyanka Mehta",
      experience: "30 years",
      speciality: "Allergist/Immunologist",
      hourlyFee: 4600,
      image: "./images/allergist.jpg",
    },
    {
      name: "Dr. Ritu Bansal",
      experience: "20 years",
      speciality: "Plastic Surgeon",
      hourlyFee: 7000,
      image: "./images/plastic_surgeon.jpg",
    },
    {
      name: "Dr. Amar Singh",
      experience: "28 years",
      speciality: "Anesthesiologist",
      hourlyFee: 4000,
      image: "./images/anesthesiologist.jpg",
    },
    {
      name: "Dr. Nisha Gupta",
      experience: "5 years",
      speciality: "Radiologist",
      hourlyFee: 3800,
      image: "./images/radiologist.jpg",
    },
    {
      name: "Dr. Rakesh Patil",
      experience: "23 years",
      speciality: "Pathologist",
      hourlyFee: 4700,
      image: "./images/pathologist.jpg",
    },
    {
      name: "Dr. Suman Devi",
      experience: "8 years",
      speciality: "Emergency Medicine Specialist",
      hourlyFee: 5000,
      image: "./images/emergency_medicine.jpg",
    },
    {
      name: "Dr. Nitin Kumar",
      experience: "12 years",
      speciality: "General Physician",
      hourlyFee: 2900,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Nandini Mishra",
      experience: "18 years",
      speciality: "Pediatrician",
      hourlyFee: 3500,
      image: "./images/pediatrician.jpg",
    },
    {
      name: "Dr. Kiran Verma",
      experience: "22 years",
      speciality: "Gynecologist & Obstetrician",
      hourlyFee: 4500,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Subodh Gupta",
      experience: "17 years",
      speciality: "Dermatologist",
      hourlyFee: 3800,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Chandra Prakash",
      experience: "15 years",
      speciality: "Cardiologist",
      hourlyFee: 5200,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Suresh Babu",
      experience: "27 years",
      speciality: "Neurologist",
      hourlyFee: 6200,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Rina Kapoor",
      experience: "19 years",
      speciality: "Orthopedic Surgeon",
      hourlyFee: 4700,
      image: "./images/default.jpg",
    },
    {
      name: "Dr. Arvind Joshi",
      experience: "23 years",
      speciality: "ENT Specialist",
      hourlyFee: 5000,
      image: "./images/default.jpg",
    },
  ];

  const teamContainer = document.querySelector(".team-container");
  const searchInput = document.getElementById("search");
  const sortOptions = document.querySelectorAll(".sort-option");
  const checkboxes = document.querySelectorAll(".checkbox-container input[type='checkbox']");
  const filterLabel = document.querySelector(".filter label");

  // Function to generate doctor cards
  function generateDoctorCards(filteredDoctors) {
    teamContainer.innerHTML = ""; // Clear current cards
    
    if (filteredDoctors.length === 0) {
      teamContainer.innerHTML = '<div class="no-results">No doctors match your search criteria.</div>';
      return;
    }

    filteredDoctors.forEach((doctor) => {
      const doctorCard = document.createElement("div");
      doctorCard.classList.add("card");

      const profileDiv = document.createElement("div");
      profileDiv.classList.add("profile");

      const doctorImage = document.createElement("img");
      doctorImage.src = doctor.image;
      doctorImage.alt = doctor.name;

      const onlineStatus = document.createElement("span");
      onlineStatus.classList.add("online"); // Add class for online status styling

      profileDiv.appendChild(doctorImage);
      profileDiv.appendChild(onlineStatus);

      const descriptionDiv = document.createElement("div");
      descriptionDiv.classList.add("description");

      const doctorName = document.createElement("h2");
      doctorName.textContent = doctor.name;

      const experience = document.createElement("p");
      experience.classList.add("experience");
      experience.textContent = `Experience - ${doctor.experience}`;

      const speciality = document.createElement("p");
      speciality.classList.add("speciality");
      speciality.textContent = `Speciality - ${doctor.speciality}`;

      const hourlyFee = document.createElement("div");
      hourlyFee.classList.add("hourlyFee");
      hourlyFee.textContent = `Hourly fee - Rs.${doctor.hourlyFee}`;

      descriptionDiv.appendChild(doctorName);
      descriptionDiv.appendChild(experience);
      descriptionDiv.appendChild(speciality);
      descriptionDiv.appendChild(hourlyFee);

      doctorCard.appendChild(profileDiv);
      doctorCard.appendChild(descriptionDiv);

      teamContainer.appendChild(doctorCard);
    });
  }

  // Function to filter doctors based on selected specialities
  function filterDoctors() {
    const selectedSpecialities = Array.from(checkboxes)
      .filter(checkbox => checkbox.checked)
      .map(checkbox => checkbox.value);

    // If no specialities are selected, show all doctors
    if (selectedSpecialities.length === 0) {
      return [...doctors];
    }

    return doctors.filter(doctor => 
      selectedSpecialities.includes(doctor.speciality)
    );
  }

  // Function to search doctors by name
  function searchDoctors(filteredDoctors) {
    const searchQuery = searchInput.value.toLowerCase();
    return filteredDoctors.filter(doctor => 
      doctor.name.toLowerCase().includes(searchQuery)
    );
  }

  // Function to sort doctors based on selected sort criteria
  function sortDoctors(filteredDoctors, sortValue) {
    if (sortValue === "experience") {
      return [...filteredDoctors].sort((a, b) => {
        const expA = parseInt(a.experience.split(" ")[0]);
        const expB = parseInt(b.experience.split(" ")[0]);
        return expB - expA; // High to low
      });
    } else if (sortValue === "hourlyFeeHighLow") {
      return [...filteredDoctors].sort((a, b) => b.hourlyFee - a.hourlyFee);
    } else if (sortValue === "hourlyFeeLowHigh") {
      return [...filteredDoctors].sort((a, b) => a.hourlyFee - b.hourlyFee);
    }
    return [...filteredDoctors]; // Default case (including "all")
  }

  // Function to update the display based on current filters
  function updateDisplay() {
    let filteredDoctors = filterDoctors();
    filteredDoctors = searchDoctors(filteredDoctors);
    
    // Get the active sort option
    const activeSort = document.querySelector(".sort-option.active");
    const sortValue = activeSort ? activeSort.dataset.value : "all";
    
    const sortedDoctors = sortDoctors(filteredDoctors, sortValue);
    generateDoctorCards(sortedDoctors);
  }

  // Event listeners
  searchInput.addEventListener("input", updateDisplay);

  // Sort option click handler
  sortOptions.forEach(option => {
    option.addEventListener("click", function(e) {
      e.preventDefault();
      sortOptions.forEach(opt => opt.classList.remove("active"));
      this.classList.add("active");
      updateDisplay();
    });
  });

  // Checkbox change handler
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener("change", updateDisplay);
  });

  // Filter toggle
  filterLabel.addEventListener("click", function(e) {
    // Prevent this from triggering the document click handler below
    e.stopPropagation();
    document.querySelector(".filter").classList.toggle("active");
  });

  // Close filter when clicking outside
  document.addEventListener("click", function() {
    document.querySelector(".filter").classList.remove("active");
  });

  // Prevent filter from closing when clicking inside it
  document.querySelector(".checkbox-container").addEventListener("click", function(e) {
    e.stopPropagation();
  });

  // Initialize with "All" sort option selected
  document.querySelector('.sort-option[data-value="all"]').classList.add("active");
  
  // Initial load
  updateDisplay();
});



//Nav Bar

document.addEventListener('DOMContentLoaded', function() {
  const mobileMenuButton = document.querySelector('.mobile-menu-button');
  const navLinks = document.querySelector('.nav-links');
  const userActions = document.querySelector('.user-actions');
  
  mobileMenuButton.addEventListener('click', function() {
    this.classList.toggle('active');
    navLinks.classList.toggle('active');
    userActions.classList.toggle('active');
    document.querySelector('.navbar').classList.toggle('active');
  });
  
  // Add scroll effect
  window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
      navbar.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
      navbar.style.padding = '0.5rem 2rem';
    } else {
      navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
      navbar.style.padding = '1rem 2rem';
    }
  });
});