module Api
  module W
    module V1
      # RLS example: rows are only visible to their owner, so another user's
      # id simply isn't found (404), whatever this controller does.
      class PrivateNotesController < ApplicationController
        def create
          authorize PrivateNote
          note = PrivateNote.new(body: params.expect(private_note: [ :body ])[:body], owner_sub: current_user_sub)
          return render_errors(note) unless note.save

          render json: { id: note.id, private_note: note }, status: :created
        end

        def destroy
          note = PrivateNote.find(params[:id])
          authorize note
          note.destroy!

          render json: { id: note.id }
        end
      end
    end
  end
end
