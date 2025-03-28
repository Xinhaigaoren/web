// app.js
const supabase = createClient(
  'https://ouzvzbwmygtktqzjltmp.supabase.co', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91enZ6YndteWd0a3RxempsdG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMDA3NzIsImV4cCI6MjA1ODU3Njc3Mn0.QEk7NZG9qBLovTHzT9mNhl__PqfqxCoQs26AlLhaGnY'
);

// 订阅消息变更
const channel = supabase
  .channel('realtime-messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages'
  }, (payload) => {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML += `<div>${payload.new.content}</div>`;
  })
  .subscribe();

// 发送消息
async function sendMessage() {
  const input = document.getElementById('input');
  const { error } = await supabase
    .from('messages')
    .insert([{ content: input.value }]);
  if (!error) input.value = '';
}
