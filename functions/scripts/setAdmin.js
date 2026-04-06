/**
 * setAdmin.js
 * 
 * Securly sets the admin custom claim for a specific Firebase user UID.
 * 
 * PREREQUISITES:
 * 1. You must download a Service Account Key from your Firebase Console.
 *    (Project Settings -> Service Accounts -> Generate new private key)
 * 2. Save the downloaded JSON file as `serviceAccountKey.json` IN THIS DIRECTORY.
 *    WARNING: DO NOT commit the serviceAccountKey.json file to version control! 
 *    Ensure it is in your .gitignore.
 * 3. Run this script via Node.js from the `functions` directory.
 * 
 * USAGE:
 * node scripts/setAdmin.js <USER_UID>
 * 
 * Example:
 * node scripts/setAdmin.js abc123def456
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Check for UID argument
const uid = process.argv[2];
if (!uid) {
  console.error("\x1b[31m%s\x1b[0m", "Error: You must provide a highly specific User UID.");
  console.log("Usage: node scripts/setAdmin.js <USER_UID>");
  process.exit(1);
}

// Verify Service Account Key exists
const serviceAccountPath = path.resolve(__dirname, "serviceAccountKey.json");
if (!fs.existsSync(serviceAccountPath)) {
  console.error("\x1b[31m%s\x1b[0m", "Error: serviceAccountKey.json not found!");
  console.log("Please download it from Firebase Console and place it in functions/scripts/");
  process.exit(1);
}

// Initialize Admin SDK
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

/**
 * Assigns the admin custom claim to the provided UID.
 */
async function setAdminRole(targetUid) {
  try {
    console.log(`Setting admin claim for UID: ${targetUid}...`);
    await admin.auth().setCustomUserClaims(targetUid, { admin: true });
    console.log("\x1b[32m%s\x1b[0m", `✅ Successfully added admin privileges to ${targetUid}.`);
    
    // Fetch the user to verify
    const userRecord = await admin.auth().getUser(targetUid);
    console.log("Verification checks out. Current Claims:", userRecord.customClaims);
    
    process.exit(0);

  } catch (error) {
    console.error("\x1b[31m%s\x1b[0m", "❌ Error setting custom claims:");
    console.error(error);
    process.exit(1);
  }
}

// Execute
setAdminRole(uid);
