'use client';

import { useState } from 'react';

interface Board {
  id: string;
  name: string;
  cards: any[];
}

interface TaskListViewProps {
  project: any;
  employees: any[];
  onUpdate: () => void;
}

export default function TaskListView({ project, employees, onUpdate }: TaskListViewProps) {
  const [boards, setBoards] = useState<Board[]>(project.boards || []);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const allTasks = boards.flatMap(board => 
    board.cards.map(card => ({ ...card, boardId: board.id, boardName: board.name }))
  );

  const handleAddTask = async (boardId: string) => {
    if (!newTaskTitle.trim()) return;

    try {
      const res = await fetch('/api/tasks/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          boardId,
          title: newTaskTitle,
        }),
      });
      const newCard = await res.json();
      setBoards(
        boards.map(b =>
          b.id === boardId ? { ...b, cards: [...b.cards, newCard] } : b
        )
      );
      setNewTaskTitle('');
    } catch (error) {
      console.error('Failed to add task:', error);
    }
  };

  const handleUpdateTask = async (taskId: string, updates: any) => {
    try {
      await fetch('/api/tasks/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, ...updates }),
      });
      setBoards(
        boards.map(b => ({
          ...b,
          cards: b.cards.map(c =>
            c.id === taskId ? { ...c, ...updates } : c
          ),
        }))
      );
      setEditingTaskId(null);
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/tasks/cards?id=${taskId}`, { method: 'DELETE' });
      setBoards(
        boards.map(b => ({
          ...b,
          cards: b.cards.filter(c => c.id !== taskId),
        }))
      );
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-red-900 text-red-200';
      case 'HIGH':
        return 'bg-orange-900 text-orange-200';
      case 'MEDIUM':
        return 'bg-yellow-900 text-yellow-200';
      default:
        return 'bg-green-900 text-green-200';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'DONE':
        return 'text-green-400';
      case 'IN_PROGRESS':
        return 'text-blue-400';
      case 'IN_REVIEW':
        return 'text-purple-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Add Task Section */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Add New Task</h3>
        <div className="flex gap-2">
          <select
            onChange={(e) => {
              if (e.target.value) {
                handleAddTask(e.target.value);
                e.target.value = '';
              }
            }}
            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select board to add task...</option>
            {boards.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && newTaskTitle.trim() && handleAddTask(boards[0]?.id)}
            placeholder="Task title..."
            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => newTaskTitle.trim() && handleAddTask(boards[0]?.id)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            Add
          </button>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 bg-gray-900">
              <th className="px-6 py-4 text-left font-semibold">Title</th>
              <th className="px-6 py-4 text-left font-semibold">Status</th>
              <th className="px-6 py-4 text-left font-semibold">Priority</th>
              <th className="px-6 py-4 text-left font-semibold">Assigned To</th>
              <th className="px-6 py-4 text-left font-semibold">Due Date</th>
              <th className="px-6 py-4 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allTasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                  No tasks yet. Create one to get started!
                </td>
              </tr>
            ) : (
              allTasks.map(task => (
                <tr key={task.id} className="border-b border-gray-700 hover:bg-gray-700/50 transition">
                  <td className="px-6 py-4 font-medium">{task.title}</td>
                  <td className="px-6 py-4">
                    <select
                      value={task.status || 'TODO'}
                      onChange={(e) => handleUpdateTask(task.id, { status: e.target.value })}
                      className={`px-2 py-1 rounded bg-gray-700 border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${getStatusColor(task.status)}`}
                    >
                      <option value="TODO">To Do</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="IN_REVIEW">In Review</option>
                      <option value="DONE">Done</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={task.priority || 'MEDIUM'}
                      onChange={(e) => handleUpdateTask(task.id, { priority: e.target.value })}
                      className={`px-2 py-1 rounded border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${getPriorityColor(task.priority)}`}
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={task.assignedTo || ''}
                      onChange={(e) => handleUpdateTask(task.id, { assignedTo: e.target.value || null })}
                      className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="">Unassigned</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <input
                      type="date"
                      value={task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''}
                      onChange={(e) => handleUpdateTask(task.id, { dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })}
                      className="px-2 py-1 rounded bg-gray-700 border border-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="text-red-400 hover:text-red-300 transition font-semibold"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
