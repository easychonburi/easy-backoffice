'use strict';
// Run with Application Default Credentials for the NEW staging project, or the Firestore emulator.
require('./index').bootstrap(process.env.ADMIN_PIN).then(row => console.log('Created staging admin:', row.staff_id)).catch(error => { console.error(error.message); process.exitCode = 1; });
