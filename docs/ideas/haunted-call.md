# Idea: the haunted call

Status: parked on 2026-10-12. Not started. Comes after the reels are holding viewers.

## The idea

A user picks a story from the Page and gets a call. The user is the hero of that story and the AI is the villain. It is not questions and answers: the point is to make the user live the story and feel hunted.

For the current series, الشقة اللي قدامنا, the caller is Tarek and the thing behind the wall is on the line.

## What should make it frightening

- **The villain leads.** It does not answer questions; it tells the caller what they are doing. A line like "إنت ساكت ليه؟" after a silence.
- **It copies the caller.** The villain of this series imitates the hero (his own eye in the peephole, his own words repeated from behind the wall). On the call, the caller hears their own sentence come back a few seconds later, whispered and slightly wrong. This needs no AI: the phone records what they said and plays it back altered.
- **It reacts to behaviour, not only words:** silence, a raised voice, a laugh, an attempt to hang up.
- **It uses the caller's real surroundings:** the actual time of night, knocks that move between the ears in headphones, the phone vibrating with each knock.
- **It breaks the frame once:** the call drops, and it calls back.
- **It ends on a cliffhanger** that points to the next part and asks for a follow.

## Constraints

- **Strictly free.** A fully live AI voice conversation costs AI time for every minute of every caller, so it cannot be open to everyone on free tiers. Real phone calls to Egyptian numbers are paid as well.
- **So the base is a web page styled as an incoming call:** the villain's lines recorded once with the series' cast voices (the pipeline already does this), the browser's own speech recognition and audio for the caller's side, and no AI called during the call. This costs the same for one caller or a thousand.
- **Live AI is an extra, not the base:** a small part of the call where the villain picks up what the caller actually said, or a few callers a night.

## Rules for doing it safely

- The opening screen makes clear the caller is playing the hero, with an age notice and an explicit start.
- Every threat stays inside the story (the flat, the door, the wall). Nothing real about the person is used beyond a name they choose to give.
- Hanging up is always one tap.
- Nothing the caller says is stored, and the privacy page says so.

## Not known yet

- How well browser speech recognition handles Egyptian Arabic on common phones. The call must still work when it mishears, and by tapping.
- How many people will grant microphone access to a horror page.
- Current free-tier limits for live voice models.
- Who calls in the first one: the doorman عم أحمد with a warning, or the thing behind the door.

## When to come back to it

Once a published part keeps viewers past the first ten seconds, so there is an audience to send to the call. Check the kept reports (`bun run reports` on the server) for that.
