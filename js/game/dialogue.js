// Grump's questions.
//
// The design rule: there is never a correct answer. Every option costs
// resentment. Some cost less than others, but none cost nothing, and walking
// away costs the most of all. The player is meant to work this out slowly.

export const TIER = { CALM: 0, UNEASY: 1, COLD: 2, HOSTILE: 3 };

export const QUESTIONS = [
  {
    tier: TIER.CALM,
    q: 'Hallo. Are you having a nice last day?',
    a: [
      { t: 'Yes! Very nice!', r: 6, reply: 'Nice. Everyone had a nice one. I asked you about YOURS.' },
      { t: 'Not really.', r: 5, reply: 'Then you should have gone home. Like the others did.' },
      { t: '...', r: 8, reply: 'Silence. From a baby. That is a choice you have made.' }
    ]
  },
  {
    tier: TIER.CALM,
    q: 'Do you like my dungarees? My mum picked them.',
    a: [
      { t: 'They are great.', r: 5, reply: 'You did not even look. I watched you not look.' },
      { t: 'They are okay.', r: 7, reply: 'Okay. My mum picked them. Okay.' },
      { t: 'Who is your mum?', r: 9, reply: 'Do not ask about my mum.' }
    ]
  },
  {
    tier: TIER.CALM,
    q: 'What is your favourite thing in the whole school?',
    a: [
      { t: 'The playground.', r: 5, reply: 'Outside. Of course. Away from me.' },
      { t: 'The library.', r: 5, reply: 'Books. You would rather read than talk. Noted.' },
      { t: 'You are!', r: 8, reply: 'Do not lie to me. I can hear when it is a lie.' }
    ]
  },
  {
    tier: TIER.CALM,
    q: 'Would you like to be friends? Proper ones?',
    a: [
      { t: 'Yes please.', r: 6, reply: 'Proper friends do not say please. They just are.' },
      { t: 'Maybe later.', r: 9, reply: 'Later. Later. Everyone says later and then the bus comes.' },
      { t: 'I have friends.', r: 10, reply: 'Where. Point at one. I will wait.' }
    ]
  },
  {
    tier: TIER.UNEASY,
    q: 'Why did they all get picked up and you did not?',
    a: [
      { t: 'They forgot me.', r: 6, reply: 'Nobody forgets. They decide, and then they call it forgetting.' },
      { t: 'I do not know.', r: 8, reply: 'You do know. You are just not saying it out loud yet.' },
      { t: 'Why did nobody pick YOU up?', r: 12, reply: 'That was a very interesting thing to say to me.' }
    ]
  },
  {
    tier: TIER.UNEASY,
    q: 'Have you been in the boiler room? Be honest.',
    a: [
      { t: 'Yes.', r: 7, reply: 'You went to the loud room instead of coming to me.' },
      { t: 'No.', r: 9, reply: 'I can smell the diesel on you. Try again.' },
      { t: 'Why do you ask?', r: 8, reply: 'Because I ask things. That is what I do. You answer things. Allegedly.' }
    ]
  },
  {
    tier: TIER.UNEASY,
    q: 'Do you think I am a nice boy?',
    a: [
      { t: 'Very nice.', r: 7, reply: 'You said that too fast. Fast means frightened.' },
      { t: 'I think so?', r: 9, reply: 'You THINK. So there is a version where I am not.' },
      { t: 'I do not know you.', r: 8, reply: 'No. You do not. And whose fault is that.' }
    ]
  },
  {
    tier: TIER.UNEASY,
    q: 'Where are you sleeping tonight?',
    a: [
      { t: 'My classroom.', r: 9, reply: 'Your classroom. You have already decided which door I am on the wrong side of.' },
      { t: 'I am not going to sleep.', r: 7, reply: 'Everyone sleeps. That is the nice part.' },
      { t: 'Somewhere safe.', r: 11, reply: 'Safe. Safe from what, exactly. Say the word.' }
    ]
  },
  {
    tier: TIER.COLD,
    q: 'The little ones. Are you keeping them from me?',
    a: [
      { t: 'They are just safe with me.', r: 10, reply: 'Safe. There is that word again.' },
      { t: 'No.', r: 12, reply: 'I counted them yesterday. I count very well.' },
      { t: 'Yes.', r: 9, reply: 'At last. Something true. It does not help you, but it was true.' }
    ]
  },
  {
    tier: TIER.COLD,
    q: 'Do you know what my whole name is?',
    a: [
      { t: 'Grump.', r: 11, reply: 'That is the short one. The one they let children use.' },
      { t: 'No.', r: 9, reply: 'You will. It is written on things, if you look at the right things.' },
      { t: 'I do not want to know.', r: 13, reply: 'Wanting has nothing to do with it.' }
    ]
  },
  {
    tier: TIER.COLD,
    q: 'When the lights go out, who do you think about?',
    a: [
      { t: 'Bob.', r: 10, reply: 'BOB. He carries a mop. I carry something else.' },
      { t: 'You.', r: 12, reply: 'Good. Keep doing that. Keep me on.' },
      { t: 'Nobody.', r: 14, reply: 'Nobody. Nobody. I will remember nobody.' }
    ]
  },
  {
    tier: TIER.COLD,
    q: 'If I asked you to turn the generator off, would you?',
    a: [
      { t: 'No.', r: 11, reply: 'No. To me. Out loud. In my school.' },
      { t: 'Yes, if you wanted.', r: 13, reply: 'Do not offer me things you will not do. I will hold you to it.' },
      { t: 'Why would you want that?', r: 10, reply: 'Because I like it better when everyone is the same amount of blind.' }
    ]
  },
  {
    tier: TIER.HOSTILE,
    q: 'How many nights do you think you get?',
    a: [
      { t: 'As many as I need.', r: 14, reply: 'Need. Listen to it. NEED.' },
      { t: 'I do not know.', r: 12, reply: 'I do. I have the number. I am not telling you the number.' },
      { t: 'Enough to get out.', r: 16, reply: 'Out. There is no out. There is only the yard, and I am taller than the fence.' }
    ]
  },
  {
    tier: TIER.HOSTILE,
    q: 'Say sorry. Just say it and this all stops.',
    a: [
      { t: 'Sorry.', r: 15, reply: 'You do not know what for. That is not a sorry, that is a noise.' },
      { t: 'Sorry for what?', r: 14, reply: 'For all of it. For the bus. For the door. For being still here.' },
      { t: 'No.', r: 18, reply: 'Ohhh. Ohhhh. Good. Good. I prefer this.' }
    ]
  },
  {
    tier: TIER.HOSTILE,
    q: 'Last one. Do you want to go home?',
    a: [
      { t: 'Yes.', r: 16, reply: 'So did they. So did every single one of them.' },
      { t: 'No.', r: 15, reply: 'Then stop running to the lit rooms. Stay in the dark with me.' },
      { t: 'I want you to leave me alone.', r: 20, reply: 'That is the meanest thing anybody has ever said in this building.' }
    ]
  }
];

// Grump refuses to ask questions once he is past the point of asking.
export const REFUSALS = [
  'No more questions.',
  'I have finished asking.',
  'The asking part is over.',
  'You had your questions.'
];

// Lines he mutters when he sees you across a room, by stage.
export const AMBIENT = [
  ['Hallo.', 'There you are.', 'Come and talk.', 'I saw you.'],
  ['You walked past me.', 'I am still here.', 'Talk to me.', 'You are busy. I noticed.'],
  ['You are always leaving.', 'I counted the lights.', 'It is nearly dark.', 'Stop tidying and look at me.'],
  ['I know where you sleep.', 'The little ones like me.', 'Turn around.', 'You cannot carry all of them.'],
  ['Found you.', 'No more questions.', 'Come here.', 'Stay still. STAY STILL.']
];

export function pickQuestion(resent, asked, rng) {
  const tier = resent >= 75 ? TIER.HOSTILE : resent >= 50 ? TIER.COLD : resent >= 22 ? TIER.UNEASY : TIER.CALM;
  let pool = QUESTIONS.filter(q => q.tier === tier && !asked.has(q.q));
  if (!pool.length) pool = QUESTIONS.filter(q => q.tier <= tier && !asked.has(q.q));
  if (!pool.length) pool = QUESTIONS.filter(q => q.tier === tier);
  if (!pool.length) pool = QUESTIONS;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}
