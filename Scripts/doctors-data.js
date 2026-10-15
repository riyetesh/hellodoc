/* ============================================================
   HelloDoc - Shared doctor directory
   Single source of truth for the doctor list used by the
   dashboard (browse/book) and the appointments page.
   ============================================================ */

const DOCTORS = [
  { id: "d01", name: "Dr. Priya Shah", experience: 12, speciality: "General Physician", hourlyFee: 2500, image: "./images/dr priya shah.jpeg", rating: 4.8, reviews: 214, available: true, nextSlot: "Today, 4:00 PM" },
  { id: "d02", name: "Dr. Ramesh Kumar", experience: 15, speciality: "Pediatrician", hourlyFee: 3000, image: "./images/dr ramesh kumar.jpeg", rating: 4.7, reviews: 189, available: true, nextSlot: "Today, 5:30 PM" },
  { id: "d03", name: "Dr. Ananya Gupta", experience: 8, speciality: "Gynecologist & Obstetrician", hourlyFee: 4000, image: "./images/gynecologist.jpeg", rating: 4.9, reviews: 302, available: true, nextSlot: "Today, 6:00 PM" },
  { id: "d04", name: "Dr. Amit Verma", experience: 20, speciality: "Dermatologist", hourlyFee: 3500, image: "./images/Dr. Amit verma.jpeg", rating: 4.6, reviews: 156, available: false, nextSlot: "Tomorrow, 11:00 AM" },
  { id: "d05", name: "Dr. Vinay Singh", experience: 10, speciality: "Cardiologist", hourlyFee: 5000, image: "./images/dr.vinay singh.jpeg", rating: 4.8, reviews: 271, available: true, nextSlot: "Today, 3:30 PM" },
  { id: "d06", name: "Dr. Neha Yadav", experience: 25, speciality: "Neurologist", hourlyFee: 6000, image: "./images/Dr. neha yadav.jpeg", rating: 4.9, reviews: 340, available: true, nextSlot: "Today, 7:00 PM" },
  { id: "d07", name: "Dr. Sunil Rao", experience: 7, speciality: "Orthopedic Surgeon", hourlyFee: 4500, image: "./images/Dr. sunil Rao.jpeg", rating: 4.5, reviews: 98, available: true, nextSlot: "Today, 2:00 PM" },
  { id: "d08", name: "Dr. Seema Dubey", experience: 22, speciality: "ENT Specialist", hourlyFee: 4000, image: "./images/Dr.seema dubey.jpeg", rating: 4.7, reviews: 210, available: false, nextSlot: "Tomorrow, 10:00 AM" },
  { id: "d09", name: "Dr. Harish Mehta", experience: 17, speciality: "Ophthalmologist", hourlyFee: 3500, image: "./images/Dr. Subodh Gupta.jpeg", rating: 4.6, reviews: 143, available: true, nextSlot: "Today, 4:45 PM" },
  { id: "d10", name: "Dr. Shalini Agarwal", experience: 9, speciality: "Psychiatrist", hourlyFee: 3800, image: "./images/Dr. Shalini Agarwal.jpeg", rating: 4.8, reviews: 187, available: true, nextSlot: "Today, 6:15 PM" },
  { id: "d11", name: "Dr. Prakash Reddy", experience: 18, speciality: "Endocrinologist", hourlyFee: 5500, image: "./images/Dr. Prakash Reddy.jpeg", rating: 4.7, reviews: 165, available: true, nextSlot: "Today, 5:00 PM" },
  { id: "d12", name: "Dr. Manisha Sharma", experience: 14, speciality: "Pulmonologist", hourlyFee: 4700, image: "./images/Dr. Manisha Sharma.jpeg", rating: 4.6, reviews: 132, available: true, nextSlot: "Today, 3:00 PM" },
  { id: "d13", name: "Dr. Rajesh Kumar", experience: 19, speciality: "Nephrologist", hourlyFee: 5200, image: "./images/Dr. Rajesh Kumar.jpeg", rating: 4.8, reviews: 178, available: false, nextSlot: "Tomorrow, 12:00 PM" },
  { id: "d14", name: "Dr. Kavita Singh", experience: 11, speciality: "Gastroenterologist", hourlyFee: 4400, image: "./images/Dr. Kiran Verma.jpeg", rating: 4.5, reviews: 121, available: true, nextSlot: "Today, 4:30 PM" },
  { id: "d15", name: "Dr. Tarun Mehra", experience: 16, speciality: "Urologist", hourlyFee: 5000, image: "./images/Dr. Tarun Mehra.jpeg", rating: 4.6, reviews: 109, available: true, nextSlot: "Today, 6:30 PM" },
  { id: "d16", name: "Dr. Sanjeev Bhatt", experience: 21, speciality: "Oncologist", hourlyFee: 6000, image: "./images/Dr. Sanjeev Bhatt.jpeg", rating: 4.9, reviews: 288, available: true, nextSlot: "Today, 5:15 PM" },
  { id: "d17", name: "Dr. Aditi Desai", experience: 24, speciality: "Hematologist", hourlyFee: 5500, image: "./images/Dr. Aditi Desai.jpeg", rating: 4.8, reviews: 197, available: true, nextSlot: "Today, 7:30 PM" },
  { id: "d18", name: "Dr. Vikas Yadav", experience: 13, speciality: "Rheumatologist", hourlyFee: 4800, image: "./images/Dr. Vikas Yadav.jpeg", rating: 4.5, reviews: 88, available: false, nextSlot: "Tomorrow, 11:30 AM" },
  { id: "d19", name: "Dr. Rohit Malhotra", experience: 6, speciality: "Infectious Disease Specialist", hourlyFee: 3300, image: "./images/Dr. Rohit Malhotra.jpeg", rating: 4.4, reviews: 76, available: true, nextSlot: "Today, 2:30 PM" },
  { id: "d20", name: "Dr. Priyanka Mehta", experience: 30, speciality: "Allergist/Immunologist", hourlyFee: 4600, image: "./images/Dr. Priyanka Mehta.jpeg", rating: 4.9, reviews: 412, available: true, nextSlot: "Today, 6:45 PM" },
  { id: "d21", name: "Dr. Ritu Bansal", experience: 20, speciality: "Plastic Surgeon", hourlyFee: 7000, image: "./images/Dr. Ritu Bansal.jpeg", rating: 4.7, reviews: 154, available: true, nextSlot: "Today, 5:45 PM" },
  { id: "d22", name: "Dr. Amar Singh", experience: 28, speciality: "Anesthesiologist", hourlyFee: 4000, image: "./images/Dr. Amar Singh.jpeg", rating: 4.6, reviews: 141, available: true, nextSlot: "Today, 3:15 PM" },
  { id: "d23", name: "Dr. Nisha Gupta", experience: 5, speciality: "Radiologist", hourlyFee: 3800, image: "./images/Dr. Nisha Gupta.jpeg", rating: 4.4, reviews: 63, available: true, nextSlot: "Today, 4:15 PM" },
  { id: "d24", name: "Dr. Rakesh Patil", experience: 23, speciality: "Pathologist", hourlyFee: 4700, image: "./images/Dr. Rakesh Patil.jpeg", rating: 4.7, reviews: 176, available: false, nextSlot: "Tomorrow, 9:30 AM" },
  { id: "d25", name: "Dr. Suman Devi", experience: 8, speciality: "Emergency Medicine Specialist", hourlyFee: 5000, image: "./images/Dr. Suman Devi.jpeg", rating: 4.5, reviews: 118, available: true, nextSlot: "Today, 8:00 PM" },
  { id: "d26", name: "Dr. Nitin Kumar", experience: 12, speciality: "General Physician", hourlyFee: 2900, image: "./images/Dr. Nitin Kumar.jpeg", rating: 4.6, reviews: 167, available: true, nextSlot: "Today, 5:30 PM" },
  { id: "d27", name: "Dr. Nandini Mishra", experience: 18, speciality: "Pediatrician", hourlyFee: 3500, image: "./images/Dr. Nandini Mishra.jpeg", rating: 4.8, reviews: 231, available: true, nextSlot: "Today, 6:00 PM" },
  { id: "d28", name: "Dr. Kiran Verma", experience: 22, speciality: "Gynecologist & Obstetrician", hourlyFee: 4500, image: "./images/Dr. Kiran Verma.jpeg", rating: 4.7, reviews: 199, available: true, nextSlot: "Today, 4:00 PM" },
  { id: "d29", name: "Dr. Subodh Gupta", experience: 17, speciality: "Dermatologist", hourlyFee: 3800, image: "./images/Dr. Subodh Gupta.jpeg", rating: 4.6, reviews: 152, available: true, nextSlot: "Today, 7:15 PM" },
  { id: "d30", name: "Dr. Chandra Prakash", experience: 15, speciality: "Cardiologist", hourlyFee: 5200, image: "./images/Dr. Chandra Prakash.jpeg", rating: 4.8, reviews: 243, available: true, nextSlot: "Today, 3:45 PM" },
  { id: "d31", name: "Dr. Suresh Babu", experience: 27, speciality: "Neurologist", hourlyFee: 6200, image: "./images/Dr. Suresh Babu.jpeg", rating: 4.9, reviews: 356, available: true, nextSlot: "Today, 6:30 PM" },
  { id: "d32", name: "Dr. Rina Kapoor", experience: 19, speciality: "Orthopedic Surgeon", hourlyFee: 4700, image: "./images/Dr. Rina Kapoor.jpeg", rating: 4.7, reviews: 184, available: true, nextSlot: "Today, 5:00 PM" },
  { id: "d33", name: "Dr. Arvind Joshi", experience: 23, speciality: "ENT Specialist", hourlyFee: 5000, image: "./images/Dr. Arvind Joshi.jpeg", rating: 4.8, reviews: 205, available: true, nextSlot: "Today, 4:45 PM" },
];

// Distinct specialities (order-preserving) for the filter UI.
const SPECIALITIES = [...new Set(DOCTORS.map((d) => d.speciality))];

function getDoctorById(id) {
  return DOCTORS.find((d) => d.id === id) || null;
}

// `const` at top level of a classic script creates a lexical global binding
// but does NOT attach to `window`. Expose them explicitly so other scripts
// (dashboard.js, appointments-page.js) can read them via window.*.
window.DOCTORS = DOCTORS;
window.SPECIALITIES = SPECIALITIES;
window.getDoctorById = getDoctorById;
