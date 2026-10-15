import type { StoryInput } from "../schemas/story";

// Hand-written story for the sample video, so the sample needs no story-writing service.
export const sampleStory: StoryInput = {
  title: "بسبوسة والطيارة الورق",
  description: "سلمى وقطتها بسبوسة بيدوروا على الطيارة الورق اللي طارت بعيد.",
  hook: "الطيارة راحت فين؟",
  hashtags: ["#حواديت", "#قصص_اطفال", "#حدوتة"],
  characterSheet:
    "Salma, a cheerful Egyptian girl of about seven, round face, big brown eyes, curly dark brown hair in two puffy pigtails tied with yellow ribbons, wearing a yellow t-shirt with a small white star, blue denim shorts and white sneakers",
  styleSheet:
    "bright 3D animated film still in a modern family-film style, soft rounded shapes, big expressive eyes, warm cheerful colour palette, soft bright lighting, gentle depth of field, wide 16:9 landscape composition",
  seed: 1234,
  scenes: [
    {
      narration: "الطيارة الورق… طارت لفوق خالص!",
      imagePrompt:
        "low-angle close shot looking up at a bright red and yellow paper kite with a long ribbon tail flying high in a clear blue sky above the rooftops of a small Egyptian neighbourhood, a loose white string trailing down from it, fluffy white clouds, warm morning sunlight from the left",
      motionPrompt:
        "The red and yellow kite climbs higher into the blue sky, its ribbon tail fluttering in the breeze, the loose string swinging below it, clouds drifting slowly; the camera stays fixed.",
    },
    {
      narration: "سلمى بصّت لفوق وقالت: يا خبر!",
      imagePrompt:
        "medium shot of the little girl standing on a sunny rooftop with potted plants and a line of colourful laundry, her face turned up to the sky, her mouth open in surprise, one hand on her cheek and the other pointing up, a small orange cat sitting by her feet looking up too, warm morning light",
      motionPrompt:
        "The little girl lifts her pointing hand higher and says her line, her eyes following the sky; the orange cat by her feet tilts its head up; the laundry sways gently; the camera pushes in very slowly.",
    },
    {
      narration: "وبسبوسة قالت: ماتخافيش… هنلاقيها سوا!",
      imagePrompt:
        "close shot of a small fluffy orange cat with white paws and a green collar standing on its hind legs on the rooftop, one paw raised confidently, a big friendly smile, the little girl's yellow sneakers visible behind it, potted plants and blue sky in the background, bright warm light",
      motionPrompt:
        "The orange cat raises its paw higher and speaks its line with a big smile, its tail swishing happily from side to side, a soft breeze moving its fur; the camera stays fixed.",
    },
  ],
};
