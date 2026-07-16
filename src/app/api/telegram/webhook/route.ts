import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

interface TelegramMessage {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text: string;
  };
}

async function sendTelegramMessage(chatId: number, text: string) {
  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return false;
  }
}

async function handleTelegramMessage(message: TelegramMessage['message']) {
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const userId = message.from.id;
  const userName = message.from.first_name || 'User';
  const lowerText = text.toLowerCase();

  try {
    // Task Management Commands
    if (text === '/start') {
      const welcome = `
👋 <b>Welcome to FleetPilot!</b>

I'm your personal assistant + task manager. You can:

<b>📋 Task Commands:</b>
/tasks - Show all tasks
/today - Tasks due today
/urgent - Urgent tasks
/stats - Task statistics
/help - Show commands
/create [title] - Create task

<b>💬 Or just chat with me!</b>
Ask me anything about your fleet, tasks, or business. I'm here to help.

What would you like to do?
      `;
      await sendTelegramMessage(chatId, welcome);
      return;
    }

    if (text === '/help') {
      const help = `
<b>📋 Task Manager:</b>
/tasks - List all tasks
/today - Tasks due today
/urgent - Urgent tasks
/stats - Statistics
/create [title] - Create new task

<b>💬 Personal Assistant:</b>
Just type your question and I'll help!

Examples:
• "How many trucks do I have?"
• "What's my load status?"
• "Show me today's schedule"
• "Create a task for maintenance"
      `;
      await sendTelegramMessage(chatId, help);
      return;
    }

    if (text === '/tasks') {
      const tasks = await prisma.taskCard.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      });

      if (tasks.length === 0) {
        await sendTelegramMessage(chatId, '📭 No tasks found.');
        return;
      }

      let taskList = '📋 <b>Recent Tasks:</b>\n\n';
      tasks.forEach((task, i) => {
        const priority = task.priority === 'URGENT' ? '🔴' : 
                        task.priority === 'HIGH' ? '🟠' : 
                        task.priority === 'MEDIUM' ? '🟡' : '🟢';
        taskList += `${i + 1}. ${priority} <b>${task.title}</b>\n`;
        taskList += `   Status: ${task.status || 'TODO'}\n`;
        if (task.dueDate) {
          taskList += `   Due: ${new Date(task.dueDate).toLocaleDateString()}\n`;
        }
        taskList += '\n';
      });

      await sendTelegramMessage(chatId, taskList);
      return;
    }

    if (text === '/today') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayTasks = await prisma.taskCard.findMany({
        where: {
          dueDate: {
            gte: today,
            lt: tomorrow,
          },
        },
        orderBy: { priority: 'desc' },
      });

      if (todayTasks.length === 0) {
        await sendTelegramMessage(chatId, '✅ No tasks due today!');
        return;
      }

      let taskList = `📅 <b>Tasks Due Today (${todayTasks.length}):</b>\n\n`;
      todayTasks.forEach((task, i) => {
        const priority = task.priority === 'URGENT' ? '🔴' : 
                        task.priority === 'HIGH' ? '🟠' : 
                        task.priority === 'MEDIUM' ? '🟡' : '🟢';
        taskList += `${i + 1}. ${priority} <b>${task.title}</b>\n`;
        taskList += `   Status: ${task.status || 'TODO'}\n`;
      });

      await sendTelegramMessage(chatId, taskList);
      return;
    }

    if (text === '/urgent') {
      const urgentTasks = await prisma.taskCard.findMany({
        where: { priority: 'URGENT' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (urgentTasks.length === 0) {
        await sendTelegramMessage(chatId, '✅ No urgent tasks!');
        return;
      }

      let taskList = `🔴 <b>Urgent Tasks (${urgentTasks.length}):</b>\n\n`;
      urgentTasks.forEach((task, i) => {
        taskList += `${i + 1}. <b>${task.title}</b>\n`;
        taskList += `   Status: ${task.status || 'TODO'}\n`;
        if (task.dueDate) {
          taskList += `   Due: ${new Date(task.dueDate).toLocaleDateString()}\n`;
        }
        taskList += '\n';
      });

      await sendTelegramMessage(chatId, taskList);
      return;
    }

    if (text === '/stats') {
      const total = await prisma.taskCard.count();
      const done = await prisma.taskCard.count({ where: { status: 'DONE' } });
      const inProgress = await prisma.taskCard.count({ where: { status: 'IN_PROGRESS' } });
      const urgent = await prisma.taskCard.count({ where: { priority: 'URGENT' } });

      const stats = `
📊 <b>Task Statistics:</b>

Total Tasks: <b>${total}</b>
✅ Completed: <b>${done}</b>
⚙️ In Progress: <b>${inProgress}</b>
🔴 Urgent: <b>${urgent}</b>

Completion Rate: <b>${total > 0 ? Math.round((done / total) * 100) : 0}%</b>
      `;

      await sendTelegramMessage(chatId, stats);
      return;
    }

    if (text.startsWith('/create ')) {
      const title = text.substring(8).trim();
      if (!title) {
        await sendTelegramMessage(chatId, '❌ Please provide a task title.\n\nExample: /create Review maintenance logs');
        return;
      }

      const board = await prisma.taskBoard.findFirst();
      if (!board) {
        await sendTelegramMessage(chatId, '❌ No task boards found. Please create a project in the web app first.');
        return;
      }

      const task = await prisma.taskCard.create({
        data: {
          projectId: board.projectId,
          boardId: board.id,
          title: title,
          priority: 'MEDIUM',
        },
      });

      await sendTelegramMessage(chatId, `✅ <b>Task created!</b>\n\n📌 <b>${task.title}</b>\n\nManage it in the web app at /tasks`);
      return;
    }

    // Personal Assistant - respond to natural questions
    // For non-task messages
    if (lowerText.includes('truck') || lowerText.includes('load') || lowerText.includes('driver')) {
      const response = `🚛 I can help with that! Here are your options:\n\n• Go to <b>/trucks</b> to manage trucks
• Go to <b>/loads</b> to manage loads
• Go to <b>/drivers</b> to manage drivers
• Or ask me specific questions and I'll help!\n\nWhat would you like to know?`;
      await sendTelegramMessage(chatId, response);
      return;
    }

    if (lowerText.includes('help') || lowerText.includes('what can')) {
      const response = `I can help you with:\n\n<b>📋 Tasks:</b>
/tasks - View all tasks
/today - Today's tasks
/urgent - Urgent tasks
/stats - Statistics
/create [name] - Create new task\n\n<b>🚛 Fleet Management:</b>
View trucks, loads, drivers, and more in the web app\n\n<b>💬 Ask me anything!</b>
Questions about your fleet, status, or anything else.`;
      await sendTelegramMessage(chatId, response);
      return;
    }

    // Default response for general questions
    const defaultResponse = `Got it! 📝\n\n"${text}"\n\nFor task management, use:\n/tasks - View tasks\n/create [title] - Create task\n/today - Today's tasks\n/urgent - Urgent tasks\n\nOr ask me specific questions about your fleet!`;
    await sendTelegramMessage(chatId, defaultResponse);

  } catch (error) {
    console.error('Error handling Telegram message:', error);
    await sendTelegramMessage(chatId, '❌ Something went wrong. Please try again.');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as TelegramMessage;

    // Handle incoming message
    if (body.message) {
      await handleTelegramMessage(body.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
