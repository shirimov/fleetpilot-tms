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
  const text = message.text.trim().toLowerCase();
  const userId = message.from.id;

  try {
    // /start - Welcome message
    if (text === '/start') {
      const welcome = `
👋 <b>Welcome to FleetPilot TMS!</b>

Available commands:
/tasks - Show all tasks
/create - Create new task
/today - Tasks due today
/urgent - Urgent tasks
/stats - Task statistics
/help - Show this message

💬 You can also just chat for assistance!
      `;
      await sendTelegramMessage(chatId, welcome);
      return;
    }

    // /help - Show commands
    if (text === '/help') {
      const help = `
<b>FleetPilot TMS Commands:</b>

📋 <b>Task Management:</b>
/tasks - List all tasks
/create - Create new task
/today - Tasks due today
/urgent - Urgent tasks
/assigned - Your assigned tasks

📊 <b>Analytics:</b>
/stats - Task statistics
/status - Project status overview

<b>Need help?</b> Just type your question!
      `;
      await sendTelegramMessage(chatId, help);
      return;
    }

    // /tasks - List all tasks
    if (text === '/tasks') {
      const tasks = await prisma.taskCard.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { labels: true },
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

    // /today - Tasks due today
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

    // /urgent - Urgent tasks
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

    // /stats - Task statistics
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

    // Default: acknowledge and offer help
    const response = `
Got it! You said: "${message.text}"

I'm FleetPilot TMS assistant. Here's what I can do:

📋 View tasks: /tasks
🔴 Urgent tasks: /urgent
📅 Today's tasks: /today
📊 Statistics: /stats

Or just ask me anything about your tasks! 💬
    `;

    await sendTelegramMessage(chatId, response);
  } catch (error) {
    console.error('Error handling Telegram message:', error);
    await sendTelegramMessage(chatId, '❌ Error processing your request. Please try again.');
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
