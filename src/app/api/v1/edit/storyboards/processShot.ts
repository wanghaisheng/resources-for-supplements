import {
  ClapProject,
  ClapSegment,
  getClapAssetSourceType,
  newSegment,
  filterSegments,
  ClapSegmentFilteringMode,
  ClapSegmentCategory,
  ClapOutputType,
  ClapSegmentStatus
} from "@aitube/clap"
import { ClapCompletionMode } from "@aitube/client"
import { getVideoPrompt } from "@aitube/engine"

import { getPositivePrompt } from "@/app/api/utils/imagePrompts"

import { generateStoryboard } from "./generateStoryboard"

export async function processShot({
  shotSegment,
  existingClap,
  newerClap,
  mode,
  turbo,
}: {
  shotSegment: ClapSegment
  existingClap: ClapProject
  newerClap: ClapProject
  mode: ClapCompletionMode
  turbo: boolean
}): Promise<void> {

  const shotSegments: ClapSegment[] = filterSegments(
    ClapSegmentFilteringMode.BOTH,
    shotSegment,
    existingClap.segments
  )

  const shotStoryboardSegments: ClapSegment[] = shotSegments.filter(s =>
    s.category === ClapSegmentCategory.STORYBOARD
  )

  let shotStoryboardSegment: ClapSegment | undefined = shotStoryboardSegments.at(0)

  // TASK 1: GENERATE MISSING STORYBOARD SEGMENT
  if (!shotStoryboardSegment) {
    shotStoryboardSegment = newSegment({
      track: 1,
      startTimeInMs: shotSegment.startTimeInMs,
      endTimeInMs: shotSegment.endTimeInMs,
      assetDurationInMs: shotSegment.assetDurationInMs,
      category: ClapSegmentCategory.STORYBOARD,
      prompt: "",
      assetUrl: "",
      outputType: ClapOutputType.IMAGE,
    })

    // we fix the existing clap
    if (shotStoryboardSegment) {
      existingClap.segments.push(shotStoryboardSegment)
    }

    console.log(`[api/v1/edit/storyboards] processShot: generated storyboard segment [${shotSegment.startTimeInMs}:${shotSegment.endTimeInMs}]`)
  }

  if (!shotStoryboardSegment) { throw new Error(`failed to generate a newSegment`) }

  // TASK 2: GENERATE MISSING STORYBOARD PROMPT
  if (!shotStoryboardSegment?.prompt) {
    // storyboard is missing, let's generate it
    shotStoryboardSegment.prompt = getVideoPrompt(
      shotSegments,
      existingClap.entityIndex,
      ["high quality", "crisp", "detailed"]
    )
    // console.log(`[api/v1/edit/storyboards] processShot: generating storyboard prompt: ${shotStoryboardSegment.prompt}`)
  }

  // TASK 3: GENERATE MISSING STORYBOARD BITMAP
  if (!shotStoryboardSegment.assetUrl) {
    // console.log(`[api/v1/edit/storyboards] generating image..`)

    // console.log(`we have ${existingClap.entities.length} entities`)
    // check if we have an entity image we can use
    const identityImage = existingClap.entities.find(e => e.id === shotStoryboardSegment.entityId)?.imageId
    if (identityImage) {
      // console.log(`[api/v1/edit/storyboards] processShot: using an entity to generate the storyboard..`)
    }
    try {
      shotStoryboardSegment.assetUrl = await generateStoryboard({
        prompt: getPositivePrompt(shotStoryboardSegment.prompt),
        identityImage,
        width: existingClap.meta.width,
        height: existingClap.meta.height,

        // turbo mode is mandatory if we have an identity image
        // that's because it will use PuLID instead of SDXL
        turbo: !!identityImage,
      })
      shotStoryboardSegment.assetSourceType = getClapAssetSourceType(shotStoryboardSegment.assetUrl)
      shotStoryboardSegment.status = ClapSegmentStatus.COMPLETED
    } catch (err) {
      console.log(`[api/v1/edit/storyboards] processShot: failed to generate an image: ${err}`)
      shotStoryboardSegment.status = ClapSegmentStatus.TO_GENERATE
      throw err
    }
  
    // console.log(`[api/v1/edit/storyboards] processShot: generated storyboard image: ${shotStoryboardSegment?.assetUrl?.slice?.(0, 50)}...`)  

    // if mode is full, newerClap already contains the ference to shotStoryboardSegment
    // but if it's partial, we need to manually add it
    if (mode !== ClapCompletionMode.FULL) {
      newerClap.segments.push(shotStoryboardSegment)
    }
  } else {
    console.log(`[api/v1/edit/storyboards] processShot: there is already a storyboard image: ${shotStoryboardSegment?.assetUrl?.slice?.(0, 50)}...`)
  }

}
