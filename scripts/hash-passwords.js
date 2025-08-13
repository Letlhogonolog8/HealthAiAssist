const bcrypt = require('bcrypt');

async function hashPasswords() {
  const passwords = {
    admin: 'admin123',
    doctor: 'doctor123', 
    radiologist: 'radiologist123',
    patient: 'patient123'
  };

  console.log('-- Update users with hashed passwords');
  
  for (const [username, password] of Object.entries(passwords)) {
    const hashed = await bcrypt.hash(password, 10);
    console.log(`UPDATE users SET password = '${hashed}' WHERE username = '${username}';`);
  }
}

hashPasswords();