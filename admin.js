document.addEventListener('DOMContentLoaded', checkAdmin);
async function addGame() {
    const nameInput = document.getElementById('gameNameInput')
    const imageInput = document.getElementById('gameImageInput')
    const msgEL = document.getElementById('gameMsg')
    
    const name = nameInput.value.trim();
    const image_name = imageInput.value.trim();

    if(!name || !image_name){
        msgEL.textContent = "Please fill in both fields."; 
        msgEL.style.color = 'red';
        return;
    }
    
    try{
        const res = await fetch('/api/admin/add_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: name,
            image_name: image_name
        })
    });

    const data = await res.json();
    
    if (data.success) {
        msgEL.textContent = "Game added successfully!";
        msgEL.style.color = 'green';
        //rensa fälten efter lyckad tillläggning
        nameInput.value = '';
        imageInput.value = '';
    } 
    else {
        msgEL.textContent = "Error: " + data.error;
        msgEL.style.color = 'red';
    }
    }catch (error){
        msgEL.textContent = 'network error.';
        msgEL.style.color = 'red'
    }
}
document.addEventListener('DOMContentLoaded', () => {
    checkAdmin(); //din befintliga check
    const submitBtn = document.getElementById('submitGameBtn');
    if (submitBtn){
        submitBtn.addEventListener('click', addGame);
    }
})


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