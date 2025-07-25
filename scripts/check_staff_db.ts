import { db } from '../server/db';
import { users } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function checkStaff() {
  try {
    console.log('Checking staff database...');
    
    // Get all users
    const allUsers = await db.select().from(users);
    console.log(`Total users in database: ${allUsers.length}`);
    
    // Count users by role
    const adminCount = allUsers.filter(user => user.role === 'admin').length;
    const doctorCount = allUsers.filter(user => user.role === 'doctor').length;
    const radiologistCount = allUsers.filter(user => user.role === 'radiologist').length;
    const patientCount = allUsers.filter(user => user.role === 'patient').length;
    
    console.log('User counts by role:');
    console.log(`- Admins: ${adminCount}`);
    console.log(`- Doctors: ${doctorCount}`);
    console.log(`- Radiologists: ${radiologistCount}`);
    console.log(`- Patients: ${patientCount}`);
    
    // Get doctors and radiologists
    const staffMembers = allUsers.filter(user => 
      user.role === 'doctor' || user.role === 'radiologist'
    );
    
    console.log('\nStaff members:');
    staffMembers.forEach(staff => {
      console.log(`- ${staff.fullName} (${staff.role}) - ${staff.email}`);
    });
    
    console.log('\nDatabase check complete.');
  } catch (error) {
    console.error("Error querying staff from DB:", error);
  }
}

checkStaff();
