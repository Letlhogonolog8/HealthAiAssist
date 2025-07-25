import { storage } from "../server/storage";
import { hashPassword } from "../server/auth-middleware";

async function createUsers() {
  try {
    console.log("Creating custom users...");

    // Create Patient: Tlhox with password inw73KYI
    try {
      const tlhoxPassword = await hashPassword("inw73KYI");
      await storage.createUser({
        username: "Tlhox",
        password: tlhoxPassword,
        role: "patient",
        fullName: "Tlhox Patient",
        email: "tlhox@healthai.com",
        age: 28,
        gender: "Male"
      });
      console.log("✓ Patient Tlhox created");
    } catch (error) {
      console.log("Patient Tlhox already exists or error:", error);
    }

    // Update Admin: admin with password admin001!
    try {
      const adminPassword = await hashPassword("admin001!");
      const existingAdmin = await storage.getUserByUsername("admin");
      if (existingAdmin) {
        await storage.updateUserPassword(existingAdmin.id, adminPassword);
        console.log("✓ Admin password updated");
      } else {
        await storage.createUser({
          username: "admin",
          password: adminPassword,
          role: "admin",
          fullName: "System Administrator",
          email: "admin@healthai.com"
        });
        console.log("✓ Admin created");
      }
    } catch (error) {
      console.log("Admin error:", error);
    }

    // Create Doctor: doctor_kenosi with password kenosi123
    try {
      const kenosiPassword = await hashPassword("kenosi123");
      await storage.createUser({
        username: "doctor_kenosi",
        password: kenosiPassword,
        role: "doctor",
        fullName: "Dr. Kenosi Rakgalane",
        email: "kenosi@healthai.com",
        specialization: "General Practice",
        licenseNumber: "MD54321"
      });
      console.log("✓ Doctor Kenosi created");
    } catch (error) {
      console.log("Doctor Kenosi already exists or error:", error);
    }

    // Create Radiologist: sam with password inw73KYI!!
    try {
      const samPassword = await hashPassword("inw73KYI!!");
      await storage.createUser({
        username: "sam",
        password: samPassword,
        role: "radiologist",
        fullName: "Dr. Sam Radiologist",
        email: "sam@healthai.com",
        specialization: "Medical Imaging",
        licenseNumber: "RD67890"
      });
      console.log("✓ Radiologist Sam created");
    } catch (error) {
      console.log("Radiologist Sam already exists or error:", error);
    }

    console.log("\nCredentials ready:");
    console.log("Patient: Tlhox / inw73KYI");
    console.log("Admin: admin / admin001!");
    console.log("Doctor: doctor_kenosi / kenosi123");
    console.log("Radiologist: sam / inw73KYI!!");

  } catch (error) {
    console.error("Error creating users:", error);
  }
}

createUsers();