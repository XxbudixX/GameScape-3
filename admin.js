document.addEventListener('DOMContentLoaded', checkAdmin);
async function addGame() {
    const res = await fetch('/api/admin/add_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'CS2',
            image_name: 'cs.png'
        })
    });

    const data = await res.json();
    if (data.success) {
        alert("Success!");
    } else {
        alert("Error: " + data.error);
    }}


async function loadEvents() {
    const res = await fetch('/api/events');
    const data = await res.json();

    const container = document.getElementById('eventList');
    container.innerHTML = ''; //  Rensa listan först

    data.events.forEach(event => {
        const div = document.createElement('div');

        div.innerHTML = `
            <span>${event.title}</span>
            <button onclick="deleteEvent(${event.id})">Delete</button>
        `;

        container.appendChild(div);
    });
}


async function deleteEvent(id) {
    const res = await fetch(`/api/admin/delete_event/${id}`, {
        method: 'DELETE'
    });

    const data = await res.json();
    if (data.success) {
        loadEvents(); // reload lista
    } else {
        alert("Error deleting event");
    }}



async function checkAdmin() {
    const res = await fetch('/api/me');
    const data = await res.json();

    const panel = document.getElementById('adminPanel');

    if (data.logged_in && data.role) {
        panel.style.display = 'block';
        loadEvents();
    } else {
        panel.style.display = 'none';
    }
}