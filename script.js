
import { auth, db } from "./firebase-config.js";

import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

/* ==========================================
   FINDORA AI
   Firebase Lost & Found Management System
========================================== */

// IMPORTANT: Insert the same teacher UID used in Firestore Rules.
const TEACHER_UID = "H94e2z9Nmhh7B6pnAWgtf2rKAmD3";

let items = [];
let requests = [];
let activeFilter = "All";
let selectedImageData = "";
let currentTeacher = null;
let unsubscribeItems = null;

// ==========================================
// BASIC FUNCTIONS
// ==========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const characters = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };
        return characters[character];
    });
}

function createID() {
    return Date.now().toString() +
        Math.random().toString(36).slice(2, 8);
}

function getKeywords(text) {
    const ignoredWords = [
        "the", "and", "with", "from", "that", "this",
        "have", "has", "was", "were", "item", "lost",
        "found", "near", "school", "its", "into",
        "for", "one", "two"
    ];

    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(word =>
            word.length > 2 && !ignoredWords.includes(word)
        );
}

function findMatches(newItem) {
    const oppositeType =
        newItem.type === "Lost" ? "Found" : "Lost";

    const newKeywords = new Set(
        getKeywords(
            newItem.name + " " +
            newItem.description + " " +
            newItem.location
        )
    );

    return items.filter(item => {
        if (
            item.type !== oppositeType ||
            item.status === "Returned"
        ) {
            return false;
        }

        if (
            (item.category || "").toLowerCase() !==
            newItem.category.toLowerCase()
        ) {
            return false;
        }

        const existingKeywords = getKeywords(
            item.name + " " +
            item.description + " " +
            item.location
        );

        return existingKeywords.some(word =>
            newKeywords.has(word)
        );
    });
}

// ==========================================
// IMAGE COMPRESSION
// ==========================================

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function () {
            const image = new Image();

            image.onload = function () {
                const maxDimension = 700;

                const scale = Math.min(
                    1,
                    maxDimension /
                    Math.max(image.width, image.height)
                );

                const canvas = document.createElement("canvas");

                canvas.width = Math.max(
                    1,
                    Math.round(image.width * scale)
                );

                canvas.height = Math.max(
                    1,
                    Math.round(image.height * scale)
                );

                const context = canvas.getContext("2d");

                context.drawImage(
                    image,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                resolve(
                    canvas.toDataURL("image/jpeg", 0.50)
                );
            };

            image.onerror = () => {
                reject(new Error("The image could not be opened."));
            };

            image.src = reader.result;
        };

        reader.onerror = () => {
            reject(new Error("The image could not be read."));
        };

        reader.readAsDataURL(file);
    });
}

// ==========================================
// PHOTO UPLOAD AND PREVIEW
// ==========================================

const imageInput = document.getElementById("itemImage");
const imagePreview = document.getElementById("imagePreview");
const previewImage = document.getElementById("previewImage");
const removeImageButton = document.getElementById("removeImage");

imageInput.addEventListener("change", async function () {
    const file = this.files[0];

    selectedImageData = "";
    imagePreview.hidden = true;

    if (!file) return;

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        alert("Please choose a JPG, PNG or WEBP image.");
        this.value = "";
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        alert("Please choose an image smaller than 5 MB.");
        this.value = "";
        return;
    }

    try {
        const compressedImage = await compressImage(file);

        // Keep the image within the Firestore rule limit.
        if (compressedImage.length > 650000) {
            alert(
                "This photo is too large after compression. " +
                "Please choose a smaller photo."
            );
            this.value = "";
            return;
        }

        selectedImageData = compressedImage;
        previewImage.src = selectedImageData;
        imagePreview.hidden = false;

    } catch (error) {
        alert(error.message);
        this.value = "";
        selectedImageData = "";
    }
});

removeImageButton.addEventListener("click", function () {
    selectedImageData = "";
    imageInput.value = "";
    previewImage.removeAttribute("src");
    imagePreview.hidden = true;
});

// ==========================================
// FIRESTORE ITEM LISTENER
// ==========================================

function listenForItems() {
    if (unsubscribeItems) {
        unsubscribeItems();
    }

    unsubscribeItems = onSnapshot(
        collection(db, "items"),

        snapshot => {
            items = snapshot.docs.map(document => ({
                ...document.data(),
                firestoreId: document.id
            }));

            displayItems();
            updateStats();
        },

        error => {
            console.error("Items loading error:", error);
            alert("Could not load item reports. Please refresh the page.");
        }
    );
}

// ==========================================
// SUBMIT LOST OR FOUND REPORT
// ==========================================

const itemForm = document.getElementById("itemForm");

itemForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const submitButton = itemForm.querySelector(
        'button[type="submit"]'
    );

    const type = document.getElementById("itemType").value;
    const name = document.getElementById("itemName").value.trim();
    const category = document.getElementById("itemCategory").value;
    const description =
        document.getElementById("itemDescription").value.trim();
    const location =
        document.getElementById("itemLocation").value.trim();
    const date = document.getElementById("itemDate").value;

    if (
        !type || !name || !category ||
        !description || !location || !date
    ) {
        alert("Please fill in all required fields.");
        return;
    }

    if (selectedImageData.length > 650000) {
        alert("Please select a smaller image.");
        return;
    }

    const newItem = {
        id: createID(),
        type,
        name,
        category,
        description,
        location,
        date,
        image: selectedImageData,
        status: "Available"
    };

    const matches = findMatches(newItem);

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    try {
        await setDoc(
            doc(db, "items", newItem.id),
            newItem
        );

        if (matches.length > 0) {
            alert(
                "Report submitted successfully!\n\n" +
                matches.length + " possible matching " +
                (matches.length === 1 ? "report" : "reports") +
                " found.\n\nPlease check the Browse Items section."
            );
        } else {
            alert(
                "Your " + type.toLowerCase() +
                " report has been submitted successfully!"
            );
        }

        itemForm.reset();

        selectedImageData = "";
        previewImage.removeAttribute("src");
        imagePreview.hidden = true;

    } catch (error) {
        console.error("Report submission error:", error);

        alert(
            "Your report could not be submitted. " +
            "Please check your internet connection and Firebase Rules."
        );

    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Submit Report";
    }
});

// ==========================================
// STUDENT RETURN REQUEST
// ==========================================

async function requestReturn(foundItem) {
    if (
        foundItem.type !== "Found" ||
        foundItem.status === "Returned"
    ) {
        alert("This item is not available for a return request.");
        return;
    }

    const matches = findMatches(foundItem);

    if (matches.length === 0) {
        alert(
            "No matching lost report is available yet.\n\n" +
            "A return request can be submitted when a matching Lost report exists."
        );
        return;
    }

    // ORIGINAL STUDENT PROMPTS PRESERVED
    const studentName = prompt("Enter your name:");

    if (!studentName || !studentName.trim()) {
        alert("Please enter a name.");
        return;
    }

    const studentClass = prompt(
        "Enter your class and section (Example: XII-B):"
    );

    if (!studentClass || !studentClass.trim()) {
        alert("Please enter a class and section.");
        return;
    }

    const claimReference =
        "FND-" + createID().slice(-6).toUpperCase();

    const newRequest = {
        requestId: createID(),
        claimReference,
        foundItemId: foundItem.id,
        matchedLostItemIds: matches.map(item => item.id),
        itemName: foundItem.name,
        studentName: studentName.trim(),
        studentClass: studentClass.trim(),
        status: "Pending Verification",
        requestDate: new Date().toLocaleDateString()
    };

    try {
        // One request document per found item.
        // This prevents a second student request for the same item.
        await setDoc(
            doc(db, "requests", foundItem.id),
            newRequest
        );

        alert(
            "Return request submitted successfully!\n\n" +
            "Item: " + foundItem.name +
            "\nClaim Reference: " + claimReference +
            "\n\nPlease keep this reference and contact an authorised school staff member to verify your claim."
        );

    } catch (error) {
        console.error("Return request error:", error);

        if (error.code === "permission-denied") {
            alert(
                "A return request may already exist for this item, " +
                "or Firebase Rules have denied this request."
            );
        } else {
            alert(
                "Your return request could not be submitted. " +
                "Please try again."
            );
        }
    }
}

// ==========================================
// DISPLAY PUBLIC ITEMS
// ==========================================

function displayItems() {
    const container = document.getElementById("itemsContainer");

    const searchText = document
        .getElementById("searchInput")
        .value.toLowerCase()
        .trim();

    const filteredItems = items.filter(item => {
        if (item.status === "Returned") return false;

        const searchableText = (
            item.name + " " +
            item.category + " " +
            item.description + " " +
            item.location
        ).toLowerCase();

        const matchesSearch =
            searchableText.includes(searchText);

        const matchesFilter =
            activeFilter === "All" ||
            item.type === activeFilter;

        return matchesSearch && matchesFilter;
    });

    if (filteredItems.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span>🔎</span>
                <h3>No items found</h3>
                <p>Try another search or submit a new report.</p>
            </div>`;
        return;
    }

    container.innerHTML = filteredItems.map(item => {
        const itemTypeClass = item.type.toLowerCase();

        const safeImage =
            typeof item.image === "string" &&
            /^data:image\/jpeg;base64,/i.test(item.image)
                ? `<img class="item-photo"
                    src="${item.image}"
                    alt="Photo of ${escapeHTML(item.name)}"
                    loading="lazy">`
                : "";

        const actionButton = item.type === "Found" ? `
            <button
                class="item-action"
                data-action="request"
                data-id="${escapeHTML(item.id)}">
                Request Return
            </button>` : "";

        return `
            <article class="item-card">
                ${safeImage}

                <div class="item-card-top">
                    <span class="item-type ${itemTypeClass}">
                        ${escapeHTML(item.type)}
                    </span>

                    <span class="item-category">
                        ${escapeHTML(item.category)}
                    </span>
                </div>

                <h3>${escapeHTML(item.name)}</h3>

                <p class="item-description">
                    ${escapeHTML(item.description)}
                </p>

                <div class="item-details">
                    <p><strong>Location:</strong>
                        ${escapeHTML(item.location)}</p>

                    <p><strong>Date:</strong>
                        ${escapeHTML(item.date)}</p>

                    <p><strong>Status:</strong> Available</p>
                </div>

                ${actionButton}
            </article>`;
    }).join("");
}

// ==========================================
// PUBLIC ITEM BUTTONS AND FILTERS
// ==========================================

document
    .getElementById("itemsContainer")
    .addEventListener("click", function (event) {

        const button = event.target.closest(
            '[data-action="request"]'
        );

        if (!button) return;

        const foundItem = items.find(
            item => String(item.id) === String(button.dataset.id)
        );

        if (foundItem) {
            requestReturn(foundItem);
        }
    });

document
    .getElementById("searchInput")
    .addEventListener("input", displayItems);

document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", function () {
        activeFilter = this.dataset.filter;

        document.querySelectorAll(".filter-btn").forEach(btn => {
            btn.classList.remove("active");
        });

        this.classList.add("active");
        displayItems();
    });
});

// ==========================================
// TEACHER LOGIN
// ==========================================

const teacherLoginForm =
    document.getElementById("teacherLoginForm");

const loginMessage =
    document.getElementById("loginMessage");

const adminSection =
    document.getElementById("admin");

const teacherSession =
    document.getElementById("teacherSession");

const teacherLogoutButton =
    document.getElementById("teacherLogoutButton");

teacherLoginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const email =
        document.getElementById("teacherEmail").value.trim();

    const password =
        document.getElementById("teacherPassword").value;

    const loginButton =
        document.getElementById("teacherLoginButton");

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    loginMessage.textContent = "";

    try {
        const result = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        if (result.user.uid !== TEACHER_UID) {
            await signOut(auth);

            loginMessage.textContent =
                "This account is not authorised as a teacher.";

            return;
        }

        loginMessage.textContent = "Login successful.";

    } catch (error) {
        console.error("Teacher login error:", error);

        loginMessage.textContent =
            "Login failed. Please check your email and password.";
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = "Teacher Login";
    }
});

// ==========================================
// TEACHER AUTHENTICATION STATE
// ==========================================

onAuthStateChanged(auth, async user => {
    currentTeacher = null;

    if (user && user.uid === TEACHER_UID) {
        currentTeacher = user;

        adminSection.hidden = false;
        adminSection.setAttribute("aria-hidden", "false");

        teacherLoginForm.hidden = true;
        teacherSession.hidden = false;

        await loadAdminRequests();

    } else {
        if (user) {
            await signOut(auth);
        }

        adminSection.hidden = true;
        adminSection.setAttribute("aria-hidden", "true");

        teacherLoginForm.hidden = false;
        teacherSession.hidden = true;

        requests = [];

        document.getElementById("requestsContainer").innerHTML = `
            <div class="empty-state">
                <span>📋</span>
                <h3>Teacher login required</h3>
                <p>Sign in to view return requests.</p>
            </div>`;

        updateAdminStats();
    }
});

// ==========================================
// TEACHER LOGOUT
// ==========================================

teacherLogoutButton.addEventListener("click", async function () {
    try {
        await signOut(auth);
        alert("You have been logged out successfully.");
    } catch (error) {
        console.error("Logout error:", error);
        alert("Logout failed. Please try again.");
    }
});

// ==========================================
// LOAD ADMIN REQUESTS
// ==========================================

async function loadAdminRequests() {
    if (!currentTeacher) return;

    try {
        const snapshot = await getDocs(
            collection(db, "requests")
        );

        requests = snapshot.docs.map(document => ({
            ...document.data(),
            firestoreId: document.id
        }));

        displayAdminRequests();

    } catch (error) {
        console.error("Admin requests error:", error);

        alert(
            "Could not load return requests. " +
            "Please check your Firestore Rules."
        );
    }
}

// ==========================================
// DISPLAY ADMIN REQUESTS
// ==========================================

function displayAdminRequests() {
    const container =
        document.getElementById("requestsContainer");

    if (!currentTeacher) return;

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span>📋</span>
                <h3>No return requests yet</h3>
                <p>Student requests will appear here.</p>
            </div>`;

        updateAdminStats();
        return;
    }

    container.innerHTML = [...requests].reverse().map(request => {
        let statusClass = "";

        if (request.status === "Returned") {
            statusClass = "returned";
        } else if (
            request.status === "Approved - Awaiting Handover"
        ) {
            statusClass = "approved";
        }

        let actionButtons = "";

        if (request.status === "Pending Verification") {
            actionButtons = `
                <button
                    class="admin-action approve-button"
                    data-admin-action="approve"
                    data-id="${escapeHTML(request.firestoreId)}">
                    Approve Verified Claim
                </button>`;

        } else if (
            request.status === "Approved - Awaiting Handover"
        ) {
            actionButtons = `
                <button
                    class="admin-action return-button"
                    data-admin-action="returned"
                    data-id="${escapeHTML(request.firestoreId)}">
                    Mark Item as Returned
                </button>`;

        } else {
            actionButtons = `
                <span class="completed-message">
                    ✓ Handover completed
                </span>`;
        }

        return `
            <div class="request-card">

                <div class="request-header">
                    <h3>${escapeHTML(request.itemName)}</h3>

                    <span class="request-status ${statusClass}">
                        ${escapeHTML(request.status)}
                    </span>
                </div>

                <div class="request-info">
                    <p><strong>Student:</strong>
                        ${escapeHTML(request.studentName)}</p>

                    <p><strong>Class:</strong>
                        ${escapeHTML(request.studentClass)}</p>

                    <p><strong>Claim Reference:</strong>
                        ${escapeHTML(request.claimReference)}</p>

                    <p><strong>Request Date:</strong>
                        ${escapeHTML(request.requestDate)}</p>
                </div>

                <div class="request-actions">
                    ${actionButtons}
                </div>

            </div>`;
    }).join("");

    updateAdminStats();
}

// ==========================================
// APPROVE RETURN REQUEST
// ==========================================

async function updateRequestStatus(requestId) {
    if (!currentTeacher) return;

    const request = requests.find(
        item => String(item.firestoreId) === String(requestId)
    );

    if (!request) {
        alert("Request not found.");
        return;
    }

    if (request.status !== "Pending Verification") return;

    if (!confirm(
        "Have you verified this student's claim?\n\n" +
        "Approve this return request?"
    )) {
        return;
    }

    try {
        await updateDoc(
            doc(db, "requests", request.firestoreId),
            {
                status: "Approved - Awaiting Handover"
            }
        );

        await loadAdminRequests();

        alert("Request approved successfully!");

    } catch (error) {
        console.error("Approval error:", error);
        alert("Could not approve this request.");
    }
}

// ==========================================
// MARK ITEM AS RETURNED
// ==========================================

async function markItemReturned(requestId) {
    if (!currentTeacher) return;

    const request = requests.find(
        item => String(item.firestoreId) === String(requestId)
    );

    if (!request) {
        alert("Return request not found.");
        return;
    }

    if (request.status !== "Approved - Awaiting Handover") {
        alert("Please approve the request before marking it returned.");
        return;
    }

    if (!confirm(
        "Confirm that the item has been handed over?\n\n" +
        "Item: " + request.itemName
    )) {
        return;
    }

    try {
        await updateDoc(
            doc(db, "items", request.foundItemId),
            {
                status: "Returned"
            }
        );

        for (const lostId of request.matchedLostItemIds || []) {
            const lostItem = items.find(
                item => String(item.id) === String(lostId)
            );

            if (lostItem) {
                await updateDoc(
                    doc(db, "items", lostId),
                    {
                        status: "Returned"
                    }
                );
            }
        }

        await updateDoc(
            doc(db, "requests", request.firestoreId),
            {
                status: "Returned"
            }
        );

        await loadAdminRequests();

        alert("Item successfully marked as returned!");

    } catch (error) {
        console.error("Return update error:", error);

        alert(
            "Could not update the return status. " +
            "Please check your Firebase permissions."
        );
    }
}

// ==========================================
// ADMIN ACTION BUTTONS
// ==========================================

document
    .getElementById("requestsContainer")
    .addEventListener("click", function (event) {

        const button = event.target.closest(
            "[data-admin-action]"
        );

        if (!button || !currentTeacher) return;

        const requestId = button.dataset.id;

        if (button.dataset.adminAction === "approve") {
            updateRequestStatus(requestId);
        }

        if (button.dataset.adminAction === "returned") {
            markItemReturned(requestId);
        }
    });

// ==========================================
// STATISTICS
// ==========================================

function updateStats() {
    const lost = items.filter(item =>
        item.type === "Lost" &&
        item.status !== "Returned"
    ).length;

    const found = items.filter(item =>
        item.type === "Found" &&
        item.status !== "Returned"
    ).length;

    const returned = items.filter(item =>
        item.type === "Found" &&
        item.status === "Returned"
    ).length;

    document.getElementById("lostCount").textContent = lost;
    document.getElementById("foundCount").textContent = found;
    document.getElementById("returnedCount").textContent = returned;
}

function updateAdminStats() {
    document.getElementById("pendingCount").textContent =
        requests.filter(request =>
            request.status === "Pending Verification"
        ).length;

    document.getElementById("approvedCount").textContent =
        requests.filter(request =>
            request.status === "Approved - Awaiting Handover"
        ).length;

    document.getElementById("adminReturnedCount").textContent =
        requests.filter(request =>
            request.status === "Returned"
        ).length;
}

// ==========================================
// INITIALIZE FINDORA AI
// ==========================================

function initializeFindora() {
    listenForItems();
    displayItems();
    updateStats();
    updateAdminStats();
}

initializeFindora();
