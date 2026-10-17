for (const path of ['/api/health', '/']) {
  try {
    const response = await fetch(`https://os.torneadorauniversal.com.br${path}`);
    const body = await response.text();
    console.log(path, response.status, path === '/' ? body.match(/index-[\w-]+\.(?:js|css)/g) : body);
    if (response.status !== 200) process.exitCode = 1;
  } catch (error) {
    console.log(path, error.message);
    process.exitCode = 1;
  }
}
