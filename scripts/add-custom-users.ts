import { getDb } from "../server/db";
import { hashPassword } from "../server/auth-middleware";

const db = getDb();

async function addCustomUsers() {
  try {
    console.log("Adding custom users...");

    // Add Patient: Tlhox with password inw73KYI
    const tlhoxPassword = await hashPassword("inw73KYI");
    await (db as any).insert({
      username: "Tlhox",
      password: tlhoxPassword,
      role: "patient",
      fullName: "Tlhox Patient",
      email: "tlhox@healthai.com",
      age: 28,
      gender: "Male"
    }).into("users").onConflict("username").ignore();

    // Add Admin: admin with password admin001!
    const adminPassword = await hashPassword("admin001!");
    await (db as any).insert({
      username: "admin",
      password: adminPassword,
      role: "admin",
      fullName: "System Administrator",
      email: "admin@healthai.com"
    }).into("users").onConflict("username").doUpdate({
      password: adminPassword
    });

    // Add Doctor: doctor_kenosi with password kenosi123
    const kenosiPassword = await hashPassword("kenosi123");
    await (db as any).insert({
      username: "doctor_kenosi",
      password: kenosiPassword,
      role: "doctor",
      fullName: "Dr. Kenosi Rakgalane",
      email: "kenosi@healthai.com",
      specialization: "General Practice",
      licenseNumber: "MD54321"
    }).into("users").onConflict("username").ignore();

    console.log("Custom users added successfully!");
    console.log("Credentials:");
    console.log("Patient: Tlhox / inw73KYI");
    console.log("Admin: admin / admin001!");
    console.log("Doctor: doctor_kenosi / kenosi123");

  } catch (error) {
    console.error("Error adding custom users:", error);
    throw error;
  }
}

// Run when script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  addCustomUsers().catch(console.error);
}

export { addCustomUsers };