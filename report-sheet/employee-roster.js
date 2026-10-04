/**
 * Employee roster · canonical report name + HR employee ID (+ HR / Excel spellings).
 * Admin targets are saved by row index — keep this order and append new people at the end.
 */
(function () {
  const EMPLOYEES = [
    { name: "Samaher Abdulmoghni Al Amri", code: "36684" },
    { name: "Haneen Talal Aqeel Al Madani", code: "49601" },
    { name: "Not assigned", code: "" },
    { name: "Wasim Kathem Awad", code: "22323" },
    { name: "Ahmed Saleh Ahmed Binmahfoodh", code: "50822", aliases: ["Ahmed Saleh Binmahfoodh"] },
    { name: "Ghina Assad Alameer", code: "46659", aliases: ["Ghina Assad Salem Alameer"] },
    { name: "Amjad Ahmed Alwafi", code: "49597" },
    { name: "Ghadeer Abdulhadi Attia Altayyari", code: "49973" },
    { name: "Maryam Salah Abdulrahman Tabakh", code: "48714", aliases: ["Maryam Salah Altabakh", "Maryam Altabakh"] },
    { name: "Muteb Abdullah Nasser Al Shehri", code: "50345", aliases: ["Muteb Abdullah Nasser AlShehri"] },
    { name: "Mansuor Ali Al Qahtani", code: "47674", aliases: ["Mansour Alqahtani"] },
    { name: "Ahmed Mahmoud Yousef Al Fitni", code: "50338", aliases: ["Ahmad Al Fattani", "Ahmed Al Fattani"] },
    { name: "Mohammed Abkar Mohammed Abkar Negry", code: "13251", aliases: ["Mohammed Abker Najeri", "Mohammed Najeri"] },
    { name: "Mohammed Al Khateeb", code: "24870" },
    { name: "Mohsen Zuhair Ali Al Attas", code: "48461", aliases: ["Mohsen Zuhair Alattas"] },
    { name: "Fatmah Mohammed Alasseri", code: "45615" },
    { name: "Essa Meraizeeq Almutairy", code: "45646", aliases: ["Essa Meraizeeq Saadi Almutairy"] },
    { name: "Moath Khalel Al Hjoouj", code: "31629", aliases: ["Moath Khalel Mohmmad Al Hjoouj"] },
    { name: "Khulood Abdulmajeed Albaloushi", code: "46662", aliases: ["Khulood Abdulmajeed Ghulam Albaloushi"] },
    { name: "Raoum Fahad Samkari", code: "46643", aliases: ["Raom Fahad Abbas Samkari", "Raom Samkari"] },
    { name: "Alawiyyah Rafi Saad Al Shehri", code: "49602" },
    { name: "Manal Moshref Almalki", code: "45752" },
    { name: "Lujen Sami Saeed Bazhair", code: "50093" },
    { name: "Muhannad Abdullah Makdour Minyawi", code: "50863" },
    { name: "Maqbool Omar Ashour", code: "46661", aliases: ["Magbol Omar Magbol Ashor", "Magbol Ashor", "Magbol Omar Ashor"] },
    { name: "Tawdod Al Sharef", code: "32834", aliases: ["Tawdod Atiah Al Sharef"] },
    { name: "Ali Muharraq A Alharbi", code: "48476", aliases: ["Ali Muharraq A. Alharbi"] },
    { name: "Aljawharah Saad Alsuhaim", code: "48448", aliases: ["Aljawharah Saad Mohammed Alsuhaim", "Aljawharah Alsuhaim"] },
    { name: "Hamid Saeed Mohamed Saeed", code: "47100" },
    { name: "Ziyad Faisal Kabli", code: "49786" },
    { name: "Muhannad Hamid Al Youbi", code: "49157" },
    { name: "Raghdah Khalid Shalabi", code: "50724" },
  ];

  window.EmployeeRoster = { EMPLOYEES };
})();
