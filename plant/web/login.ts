const form = document.querySelector<HTMLFormElement>('#login')!;
form.addEventListener('submit', async (e) => { e.preventDefault(); const data = new FormData(form); const message = document.querySelector('#error')!; try {
    const response = await fetch('./api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: data.get('user'), password: data.get('password') }) });
    const result = await response.json();
    if (!response.ok)
        throw new Error(result.error);
    location.assign('./app/');
}
catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
} });
