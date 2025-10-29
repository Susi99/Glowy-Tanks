const { io } = require('socket.io-client');

const socket = io('http://localhost:3000', { autoConnect: true });

socket.on('connect', () => {
  console.log('Connected as', socket.id);
  socket.emit('host', { name: 'TestGame' });
});

socket.on('join', (payload) => {
  console.log('Join payload', payload);
  socket.emit('chat:message', { text: 'Merhaba' });
});

socket.on('chat:history', (messages) => {
  console.log('History', messages);
});

socket.on('chat:message', (message) => {
  console.log('Chat message', message);
  socket.close();
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('connect error', err);
});

