const fs=require('node:fs');const path=require('node:path');const esbuild=require('esbuild-wasm');
(async()=>{
 const root=path.resolve(__dirname,'..'),dest=path.join(root,'dist');fs.mkdirSync(dest,{recursive:true});
 for(const name of ['index.html','clock.html','dashboard.html','driver.html','payroll.html','stock.html','admin.html','manifest.json','icon-192.png','icon-512.png'])fs.copyFileSync(path.join(root,name),path.join(dest,name));
 for(const name of ['admin.js','admin.css','mobile.css'])fs.copyFileSync(path.join(root,'web',name),path.join(dest,name));
 await esbuild.build({absWorkingDir:root,entryPoints:['web/client.js'],tsconfigRaw:{compilerOptions:{}},bundle:true,minify:true,outfile:path.join(dest,'firebase-client.js'),format:'iife',target:'es2020'});
 const project=process.env.FIREBASE_PROJECT_ID||'demo-easy-backoffice';
 if(!project.startsWith('demo-')&&!project.includes('staging'))throw Error('Build is limited to a staging project');
 if(!project.startsWith('demo-')&&!process.env.FIREBASE_WEB_API_KEY)throw Error('FIREBASE_WEB_API_KEY required');
 const config={projectId:project,apiKey:process.env.FIREBASE_WEB_API_KEY||'demo-key',authDomain:project+'.firebaseapp.com',emulator:project.startsWith('demo-')};
 fs.writeFileSync(path.join(dest,'firebase-config.js'),'window.EASY_FIREBASE='+JSON.stringify(config)+';');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
