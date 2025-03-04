
import {
  ClapProject,
  ClapSegmentCategory,
  newSegment,
  ClapOutputType,
  ClapSegmentStatus
} from "@aitube/clap"
import { ClapCompletionMode } from "@aitube/client"

import { clapToLatentStory } from "../entities/clapToLatentStory"
import { LatentStory } from "../../types"
import { extendLatentStoryWithMoreShots } from "./extendLatentStoryWithMoreShots"
import { MAX_PROMPT_LENGTH_IN_CHARS } from "@/app/api/generators/clap/constants"
import { checkCaptions } from "../../create/checkCaptions"
import { generateMusicPrompts } from "../music/generateMusicPrompt"
import { generateSoundPrompts } from "../sounds/generateSoundPrompt"

export async function extendClapStory({
  prompt: maybePrompt,
  startTimeInMs,
  endTimeInMs,
  existingClap,
  newerClap,
  mode,
  turbo,
}: {
  prompt?: string
  startTimeInMs?: number
  endTimeInMs?: number
  existingClap: ClapProject
  newerClap: ClapProject
  mode: ClapCompletionMode
  turbo: boolean
}): Promise<void> {

  let hasCaptions = false


  let currentElapsedTimeInMs = 0
  for (const s of existingClap.segments) {
    if (s.category === ClapSegmentCategory.INTERFACE) { hasCaptions = true }
    if (s.endTimeInMs > currentElapsedTimeInMs) { currentElapsedTimeInMs = s.endTimeInMs }
  }

  const lastElapsedTimeInMs = currentElapsedTimeInMs

  const { prompt, hasCaptions: hasCaptionInNewPrompt } = checkCaptions(
    (
      typeof maybePrompt === "string" && maybePrompt.length > 0
      ? maybePrompt
      : existingClap.meta.description
    ).trim().slice(0, MAX_PROMPT_LENGTH_IN_CHARS)
  )

  // if the video already contains captions but the user asks for none for the subsequent scenes
  if (!hasCaptionInNewPrompt && hasCaptions) {
    hasCaptions = false
  }

  const latentStory: LatentStory[] = await clapToLatentStory(existingClap)
  
  const shots: LatentStory[] = await extendLatentStoryWithMoreShots({
    prompt,
    latentStory,
    nbShots: 4,
    turbo,
  })

  // console.log(`extendClapStory: going to extend, starting at ${currentElapsedTimeInMs}`)

  // this is approximate - TTS generation will determine the final duration of each shot

  const defaultSegmentDurationInMs = 3000
  // const defaultSegmentDurationInMs = 2916

  for (const { comment, image, voice } of shots) {

    // console.log(`api/v1/edit:story():  - ${comment}`)

    // note: it would be nice if we could have a convention saying that
    // track 0 is for videos and track 1 storyboards
    // 
    // however, that's a bit constraining as people will generate .clap
    // using all kind of tools and development experience,
    // and they may not wish to learn the Clap protocol format completely
    //
    // TL;DR: 
    // we should fix the Clap file editor to make it able to react videos
    // from any track number

    newerClap.segments.push(newSegment({
      track: 0,
      startTimeInMs: currentElapsedTimeInMs,
      endTimeInMs: currentElapsedTimeInMs + defaultSegmentDurationInMs,
      assetDurationInMs: defaultSegmentDurationInMs,
      category: ClapSegmentCategory.VIDEO,
      prompt: image,
      outputType: ClapOutputType.VIDEO,
      status: ClapSegmentStatus.TO_GENERATE,
    }))

    newerClap.segments.push(newSegment({
      track: 1,
      startTimeInMs: currentElapsedTimeInMs,
      endTimeInMs: currentElapsedTimeInMs + defaultSegmentDurationInMs,
      assetDurationInMs: defaultSegmentDurationInMs,
      category: ClapSegmentCategory.STORYBOARD,
      prompt: image,
      outputType: ClapOutputType.IMAGE,
      status: ClapSegmentStatus.TO_GENERATE,
    }))

    if (hasCaptions) {
      newerClap.segments.push(newSegment({
        track: 2,
        startTimeInMs: currentElapsedTimeInMs,
        endTimeInMs: currentElapsedTimeInMs + defaultSegmentDurationInMs,
        assetDurationInMs: defaultSegmentDurationInMs,
        category: ClapSegmentCategory.INTERFACE,
        prompt: comment,
        // assetUrl: `data:text/plain;base64,${btoa(comment)}`,
        assetUrl: comment,
        outputType: ClapOutputType.TEXT,
        status: ClapSegmentStatus.TO_GENERATE,
      }))
    }

    newerClap.segments.push(newSegment({
      track: 3,
      startTimeInMs: currentElapsedTimeInMs,
      endTimeInMs: currentElapsedTimeInMs + defaultSegmentDurationInMs,
      assetDurationInMs: defaultSegmentDurationInMs,
      category: ClapSegmentCategory.DIALOGUE,
      prompt: voice,
      outputType: ClapOutputType.AUDIO,
      status: ClapSegmentStatus.TO_GENERATE,
    }))

    // the presence of a camera is mandatory
    newerClap.segments.push(newSegment({
      track: 4,
      startTimeInMs: currentElapsedTimeInMs,
      endTimeInMs: currentElapsedTimeInMs + defaultSegmentDurationInMs,
      assetDurationInMs: defaultSegmentDurationInMs,
      category: ClapSegmentCategory.CAMERA,
      prompt: "video",
      outputType: ClapOutputType.TEXT,
      status: ClapSegmentStatus.TO_GENERATE,
    }))

    currentElapsedTimeInMs += defaultSegmentDurationInMs
  }
  console.log(`extendClapStory(): extended the story by ${shots.length} shots using prompt: ${prompt}`)


  const newerLatentStory = await clapToLatentStory(newerClap)

  let soundPrompts: string[] = []

  try {
    soundPrompts = await generateSoundPrompts({
      prompt,
      latentStory: newerLatentStory,
      turbo,
    })
    const soundPrompt = soundPrompts.at(0)
    if (!soundPrompt) { throw new Error(`not enough sound prompts`) }

    // console.log("musicPrompt:", musicPrompt)

    newerClap.segments.push(newSegment({
      track: 5,
      startTimeInMs: lastElapsedTimeInMs,
      endTimeInMs: currentElapsedTimeInMs,
      assetDurationInMs: currentElapsedTimeInMs - lastElapsedTimeInMs,
      category: ClapSegmentCategory.SOUND,
      prompt: soundPrompt,
      outputType: ClapOutputType.AUDIO,
      status: ClapSegmentStatus.TO_GENERATE,
    }))
  } catch (err) {
    console.error(`[api/v1/create] failed to generate sound prompts`)
    // soundPrompts.push("lofi hiphop loop")
  }

  let musicPrompts: string[] = []
  try {
    musicPrompts = await generateMusicPrompts({
      prompt,
      latentStory,
      turbo,
    })
  } catch (err) {
    console.error(`[api/v1/edit/story] failed to generate additional music prompts`)

    musicPrompts.push(
      existingClap.segments
      .filter(s => s.category === ClapSegmentCategory.MUSIC)
      .map(s => s.prompt)
      .filter(s => s)
      .at(0) || "lofi hiphop loop"
    )
  }

  newerClap.segments.push(newSegment({
    track: 6,
    startTimeInMs: lastElapsedTimeInMs,
    endTimeInMs: currentElapsedTimeInMs,
    assetDurationInMs: currentElapsedTimeInMs - lastElapsedTimeInMs,
    category: ClapSegmentCategory.MUSIC,
    prompt: `${musicPrompts.at(0) || ""}`,
    outputType: ClapOutputType.AUDIO,
    status: ClapSegmentStatus.TO_GENERATE,
  }))

}
