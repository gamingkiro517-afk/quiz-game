const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const ADMIN_PASS = '140206';
const ANSWERS = [
    'B','C','A','B','C','B','D','A','C','B', 
    'D','C','A','B','C','B','D','A','D','C', 
    'C','B','B','A','D','C','C','B','A','B', 
    'A','B','C','C','B','D','A','A','A','B', 
    'A','C','A','A','C','B','C','B','B','A'
];

let gameState = {
    status: 'waiting', // Trạng thái: waiting (chờ), running (đang thi), stopped (tạm dừng)
    currentQuestion: -1,
    isActive: false,
    players: {}, 
    correctResponders: [],
    timeLeft: 15
};
let timer;

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        if (gameState.status !== 'waiting') {
            socket.emit('joinError', 'Bài thi đang diễn ra, bạn không thể tham gia lúc này!');
            return;
        }
        gameState.players[socket.id] = { id: socket.id, name: data.name, team: data.team, score: 0, answered: false };
        socket.emit('joinSuccess');
        updateAdminDashboard();
    });

    socket.on('submitAnswer', (answer) => {
        let player = gameState.players[socket.id];
        if (player && gameState.isActive && !player.answered && gameState.status === 'running') {
            player.answered = true;
            if (answer === ANSWERS[gameState.currentQuestion]) {
                gameState.correctResponders.push(socket.id);
            }
            socket.emit('answerReceived');
            updateAdminDashboard();
        }
    });

    socket.on('adminAuth', (pass, callback) => {
        if (pass === ADMIN_PASS) {
            socket.join('adminRoom');
            callback(true);
            updateAdminDashboard();
        } else {
            callback(false);
        }
    });

    socket.on('startGame', () => {
        if (gameState.status === 'waiting' || gameState.status === 'stopped') {
            gameState.status = 'running';
            io.emit('gameStatusChanged', 'running');
            updateAdminDashboard();
        }
    });

    socket.on('stopGame', () => {
        gameState.status = 'stopped';
        gameState.isActive = false;
        clearInterval(timer);
        io.emit('gameStatusChanged', 'stopped');
        updateAdminDashboard();
    });

    socket.on('restartGame', () => {
        gameState.status = 'waiting';
        gameState.currentQuestion = -1;
        gameState.isActive = false;
        gameState.correctResponders = [];
        gameState.timeLeft = 15;
        // Reset toàn bộ điểm người chơi hiện tại
        for (let id in gameState.players) {
            gameState.players[id].score = 0;
            gameState.players[id].answered = false;
        }
        clearInterval(timer);
        io.emit('gameRestarted');
        updateAdminDashboard();
    });

    socket.on('nextQuestion', () => {
        if (gameState.status !== 'running' || gameState.currentQuestion >= 49) return;
        
        gameState.currentQuestion++;
        gameState.isActive = true;
        gameState.correctResponders = [];
        gameState.timeLeft = 15;
        
        for (let id in gameState.players) {
            gameState.players[id].answered = false;
        }

        io.emit('newQuestion', { questionNumber: gameState.currentQuestion + 1 });
        updateAdminDashboard();

        clearInterval(timer);
        timer = setInterval(() => {
            gameState.timeLeft--;
            io.emit('timer', gameState.timeLeft);
            if (gameState.timeLeft <= 0) {
                clearInterval(timer);
                endQuestion();
            }
        }, 1000);
    });

    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            delete gameState.players[socket.id];
            updateAdminDashboard();
        }
    });
});

function endQuestion() {
    gameState.isActive = false;
    
    gameState.correctResponders.forEach((id, index) => {
        let player = gameState.players[id];
        if (player) {
            if (index === 0) player.score += 10;
            else if (index === 1) player.score += 8;
            else if (index === 2) player.score += 7;
            else player.score += 5;
        }
    });
    
    const isFinished = gameState.currentQuestion === 49;
    if (isFinished) gameState.status = 'stopped';
    
    for (let id in gameState.players) {
        io.to(id).emit('updateMyScore', gameState.players[id].score);
    }

    io.emit('questionEnd', { 
        correctAnswer: ANSWERS[gameState.currentQuestion], 
        isFinished: isFinished
    });
    
    updateAdminDashboard();
}

function updateAdminDashboard() {
    let playersArr = Object.values(gameState.players);
    playersArr.sort((a, b) => b.score - a.score); // Xếp hạng theo điểm
    
    let rank = 1;
    for (let i = 0; i < playersArr.length; i++) {
        if (i > 0 && playersArr[i].score < playersArr[i-1].score) rank = i + 1;
        playersArr[i].rank = rank;
    }

    let team1 = playersArr.filter(p => p.team === '1').reduce((sum, p) => sum + p.score, 0);
    let team2 = playersArr.filter(p => p.team === '2').reduce((sum, p) => sum + p.score, 0);

    io.to('adminRoom').emit('dashboardData', {
        status: gameState.status,
        currentQuestion: gameState.currentQuestion,
        isActive: gameState.isActive,
        players: playersArr,
        teamScores: { team1, team2 },
        answeredCount: Object.values(gameState.players).filter(p => p.answered).length,
        totalPlayers: playersArr.length
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
