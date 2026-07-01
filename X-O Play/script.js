let turn='';
let gameOver = false;//game still going
let title=document.querySelector('.title');

//choose who starts 
function chooseTurn(player){
    if(turn !== '') return; // لو اللاعب اختار قبل كده، متغيرش الدور
    turn = player;  
    title.innerHTML = `${turn.toUpperCase()}'s Turn`;  
    updateActive();  
}

//Turn between X and O
function Game(id){
    if(turn === '') return; // لو اللاعب لسه مختارش من يبدأ، متلعبش
    if(gameOver==true) return; // لو اللعبة خلصت متلعبش
       let element=document.getElementById(id);
document.querySelector('.x-player').classList.remove('active');
document.querySelector('.o-player').classList.remove('active');
      
     if(turn==='x' && element.innerHTML==='')
     {   
        element.innerHTML='x';
        turn='o';
        title.innerHTML="O's Turn";
     }
     else if(turn==='o' && element.innerHTML==='')
     {
        element.innerHTML='o';
        turn='x';
        title.innerHTML="X's Turn";
     }
    updateActive();
     Winner();
}

//highlight active player
 function updateActive(){
    if(turn === 'x'){
        document.querySelector('.x-player').classList.add('active');
    } else if(turn === 'o'){
        document.querySelector('.o-player').classList.add('active');
    }
}

 let square=[];
function End(num1,num2,num3){
title.innerHTML=`${square[num1]} is winner`;
gameOver=true;
document.getElementById('item'+num1).style.background='#2A2343';
document.getElementById('item'+num2).style.background='#2A2343';
document.getElementById('item'+num3).style.background='#2A2343';
}

//condation to check winner
function Winner(){
for(let i=1;i<10;i++){
   square[i]=document.getElementById('item'+i).innerHTML;
}
//rows
if(square[1]==square[2] && square[2]==square[3] && square[1]!=''){
   End(1,2,3)    
}
else if(square[4]==square[5] && square[5]==square[6] && square[4]!=''){
    End(4,5,6)
}
else if(square[7]==square[8] && square[8]==square[9] && square[7]!=''){
    End(7,8,9)
}
//columns
else if(square[1]==square[4] && square[4]==square[7] && square[1]!=''){
    End(1,4,7)
}
else if(square[2]==square[5] && square[5]==square[8] && square[2]!=''){
    End(2,5,8)
}
else if(square[3]==square[6] && square[6]==square[9] && square[3]!=''){
    End(3,6,9)
}
//diagonal
else if(square[1]==square [5] && square [5]==square [9] && square [1]!=''){
    End(1,5,9)
}
else if(square [3]==square [5] && square [5]==square [7] && square [3]!=''){
    End(3,5,7)
}
 // الشروط للتعادل
    let draw = true;
    for(let i = 1; i < 10; i++){
        if(square[i] === ''){
            draw = false;
        }
    }

    if(draw && !gameOver){
        title.innerHTML = "No Winner";
        gameOver = true;
    }
}
function Reset(){
    location.reload();
}